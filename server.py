"""
Polymarket Bar — Web Control Panel

Single entry point: boots Sonic Pi headless, connects to Polymarket,
and serves a web UI at http://localhost:8888 for full control.

Controls:
  - Start / Stop music
  - Choose track (.rb file)
  - Pick market from top ranked list or go autonomous
  - Pin a specific market by slug
  - View live status
"""
import asyncio
import json
import sys
import time
import glob
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from aiohttp import web

from polymarket.scorer import MarketScorer
from polymarket.websocket import PolymarketFeed
from mixer.mixer import AutonomousDJ
from osc.bridge import OSCBridge, SLOT_OSC_MAP, _scale
from sonic_pi.headless import SonicPiHeadless
from config import RESCORE_INTERVAL, LAYER_INSTRUMENTS


# ── Global state ──────────────────────────────────────────

class AppState:
    def __init__(self):
        self.sonic = None
        self.scorer = MarketScorer()
        self.osc = None
        self.dj = None
        self.feed = None
        self.audio_running = False
        self.feed_running = False
        self.current_track = None
        self.tracks = self._find_tracks()

        # Background tasks
        self._feed_task = None
        self._dj_task = None
        self._push_task = None

    def _find_tracks(self):
        """Find all .rb track files."""
        tracks = {}
        for f in sorted(glob.glob("sonic_pi/*.rb")):
            p = Path(f)
            tracks[p.stem] = str(p)
        return tracks

    def status(self):
        """Return current status as dict."""
        market_info = None
        if self.dj and self.dj.current_market:
            aid = self.dj.current_asset
            heat = self.scorer.heat(aid) if aid else 0
            vel = self.scorer.price_velocity(aid) if aid else 0
            rate = self.scorer.trade_rate(aid) if aid else 0
            bid, ask = self.scorer.spreads.get(aid, (0.4, 0.6))
            prices = list(self.scorer.price_history.get(aid, []))
            last_price = prices[-1][1] if prices else 0.5

            market_info = {
                "question": self.dj.current_market["question"],
                "slug": self.dj.current_market.get("slug", ""),
                "heat": round(heat, 3),
                "price": round(last_price, 4),
                "velocity": round(vel, 4),
                "trade_rate": round(rate, 3),
                "spread": round(ask - bid, 4),
                "tone": "bullish" if last_price >= 0.5 else "bearish",
            }

            # OSC params being sent
            if aid:
                amp = _scale(heat, 0, 1, 0.2, 1.4)
                cutoff = _scale(last_price, 0, 1, 60, 115)
                reverb = _scale(vel, 0, 1, 0.1, 0.85)
                density = _scale(rate, 0, 1, 0.1, 1.0)
                tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)
                market_info["osc"] = {
                    "amp": round(amp, 2),
                    "cutoff": round(cutoff, 1),
                    "reverb": round(reverb, 2),
                    "density": round(density, 2),
                    "tension": round(tension, 2),
                }

        # Top markets
        top_markets = []
        if self.dj and self.dj.all_markets:
            all_aids = [a for m in self.dj.all_markets for a in m["asset_ids"]]
            ranked = self.scorer.rank(all_aids)[:10]
            for aid, score in ranked:
                m = self.dj._find_market(aid)
                if m:
                    is_current = (self.dj.current_asset == aid)
                    top_markets.append({
                        "question": m["question"],
                        "slug": m.get("slug", ""),
                        "heat": round(score, 3),
                        "volume": m.get("volume", 0),
                        "playing": is_current,
                    })

        return {
            "audio_running": self.audio_running,
            "feed_running": self.feed_running,
            "current_track": self.current_track,
            "tracks": list(self.tracks.keys()),
            "pinned": self.dj.pinned_slug if self.dj else None,
            "current_market": market_info,
            "top_markets": top_markets,
            "event_rate": self._get_event_rate(),
        }

    def _get_event_rate(self):
        total = sum(len(v) for v in self.scorer.trade_times.values())
        return total


state = AppState()


# ── Background loops ──────────────────────────────────────

async def feed_loop():
    """Run the WebSocket feed."""
    state.feed_running = True
    try:
        await state.feed.connect()
    except asyncio.CancelledError:
        pass
    finally:
        state.feed_running = False


async def dj_loop():
    """Run the DJ mix loop."""
    try:
        await state.dj.run()
    except asyncio.CancelledError:
        pass


async def param_push_loop(interval=3.0):
    """Push OSC params continuously."""
    try:
        while True:
            await asyncio.sleep(interval)
            if state.dj and state.dj.current_asset and state.audio_running:
                for slot in LAYER_INSTRUMENTS:
                    try:
                        state.osc.push_market_params(slot, state.dj.current_asset)
                    except Exception:
                        pass
    except asyncio.CancelledError:
        pass


# ── API handlers ──────────────────────────────────────────

async def handle_status(request):
    return web.json_response(state.status())


async def handle_start_audio(request):
    """Boot Sonic Pi and load a track."""
    if state.audio_running:
        return web.json_response({"error": "Audio already running"}, status=400)

    data = await request.json() if request.content_length else {}
    track_name = data.get("track", "deep_bass_polymarket")

    if track_name not in state.tracks:
        return web.json_response({"error": f"Unknown track: {track_name}",
                                  "available": list(state.tracks.keys())}, status=400)

    try:
        state.sonic = SonicPiHeadless()
        await state.sonic.boot(timeout=30)

        # Update OSC to use headless cues port
        import config
        config.OSC_PORT = state.sonic.osc_cues_port
        state.osc = OSCBridge(state.scorer)

        # Update DJ's OSC bridge
        if state.dj:
            state.dj.osc = state.osc

        # Load track
        track_path = state.tracks[track_name]
        await state.sonic.run_file(track_path)
        state.current_track = track_name
        state.audio_running = True
        await asyncio.sleep(2)

        # Start param push
        state._push_task = asyncio.create_task(param_push_loop())

        return web.json_response({"ok": True, "track": track_name,
                                  "osc_port": state.sonic.osc_cues_port})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_stop_audio(request):
    """Stop Sonic Pi."""
    if not state.audio_running:
        return web.json_response({"error": "Audio not running"}, status=400)

    if state._push_task:
        state._push_task.cancel()
        state._push_task = None

    if state.sonic:
        await state.sonic.shutdown()
        state.sonic = None

    state.audio_running = False
    state.current_track = None
    return web.json_response({"ok": True})


async def handle_change_track(request):
    """Switch to a different track."""
    data = await request.json()
    track_name = data.get("track")

    if track_name not in state.tracks:
        return web.json_response({"error": f"Unknown track: {track_name}"}, status=400)

    if state.sonic and state.audio_running:
        await state.sonic.stop_code()
        await asyncio.sleep(1)
        await state.sonic.run_file(state.tracks[track_name])
        state.current_track = track_name
        await asyncio.sleep(2)
        return web.json_response({"ok": True, "track": track_name})
    else:
        return web.json_response({"error": "Audio not running"}, status=400)


async def handle_pin_market(request):
    """Pin a specific market."""
    data = await request.json()
    slug = data.get("slug")
    if not slug:
        return web.json_response({"error": "slug required"}, status=400)
    if state.dj:
        state.dj.pin_market(slug)
        return web.json_response({"ok": True, "pinned": slug})
    return web.json_response({"error": "DJ not running"}, status=400)


async def handle_unpin(request):
    """Unpin market, return to autonomous mode."""
    if state.dj:
        state.dj.unpin()
        return web.json_response({"ok": True})
    return web.json_response({"error": "DJ not running"}, status=400)


async def handle_index(request):
    return web.Response(text=HTML_PAGE, content_type="text/html")


# ── HTML UI ───────────────────────────────────────────────

HTML_PAGE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Polymarket Bar</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 14px; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }
  h1 { color: #00ff88; font-size: 24px; margin-bottom: 5px; }
  .subtitle { color: #666; margin-bottom: 20px; font-size: 12px; }
  .panel { background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .panel h2 { color: #00aaff; font-size: 16px; margin-bottom: 12px; }
  .row { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  button { background: #1a1a2e; color: #00ff88; border: 1px solid #00ff88; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 13px; }
  button:hover { background: #00ff88; color: #0a0a0f; }
  button.danger { border-color: #ff4444; color: #ff4444; }
  button.danger:hover { background: #ff4444; color: #0a0a0f; }
  button.active { background: #00ff88; color: #0a0a0f; }
  select { background: #1a1a2e; color: #e0e0e0; border: 1px solid #333; padding: 8px; border-radius: 4px; font-family: inherit; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot-on { background: #00ff88; box-shadow: 0 0 6px #00ff88; }
  .dot-off { background: #333; }
  .market-card { background: #0d0d15; border: 1px solid #1a1a2e; border-radius: 6px; padding: 12px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.2s; }
  .market-card:hover { border-color: #00aaff; }
  .market-card.playing { border-color: #00ff88; background: #0a1a10; }
  .market-question { font-size: 13px; margin-bottom: 6px; }
  .market-meta { font-size: 11px; color: #666; display: flex; gap: 16px; }
  .heat-bar { width: 60px; height: 6px; background: #1a1a2e; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; }
  .heat-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
  .current-market { background: #0a1a10; border-color: #00ff88; }
  .osc-params { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  .osc-param { background: #0d0d15; padding: 8px; border-radius: 4px; text-align: center; }
  .osc-param .label { font-size: 10px; color: #666; text-transform: uppercase; }
  .osc-param .value { font-size: 18px; color: #00aaff; margin-top: 2px; }
  .mood { font-size: 20px; text-align: center; padding: 10px; }
  .mood.bullish { color: #00ff88; }
  .mood.bearish { color: #ff6644; }
  #log { background: #08080c; border: 1px solid #1a1a2e; border-radius: 4px; padding: 10px; height: 120px; overflow-y: auto; font-size: 11px; color: #555; margin-top: 10px; }
  .log-entry { margin-bottom: 2px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 11px; }
  .badge-green { background: #0a2a10; color: #00ff88; }
  .badge-red { background: #2a0a0a; color: #ff4444; }
  .badge-blue { background: #0a0a2a; color: #00aaff; }
</style>
</head>
<body>
<div class="container">
  <h1>THE POLYMARKET BAR</h1>
  <div class="subtitle">Sonic predictions. Real-time. Always.</div>

  <!-- Audio Controls -->
  <div class="panel">
    <h2>Audio Engine</h2>
    <div class="row">
      <span class="status-dot" id="audio-dot"></span>
      <span id="audio-status">Stopped</span>
      <select id="track-select"></select>
      <button id="btn-start" onclick="startAudio()">Start</button>
      <button id="btn-stop" class="danger" onclick="stopAudio()">Stop</button>
      <button onclick="changeTrack()">Switch Track</button>
    </div>
  </div>

  <!-- Current Market -->
  <div class="panel" id="current-panel" style="display:none">
    <h2>Now Playing</h2>
    <div id="current-market-name" class="market-question" style="font-size:16px; color:#00ff88;"></div>
    <div id="current-mood" class="mood"></div>
    <div class="osc-params" id="osc-params"></div>
    <div class="row" style="margin-top:12px;">
      <span id="pinned-badge"></span>
      <button onclick="unpinMarket()">Autonomous Mode</button>
    </div>
  </div>

  <!-- Feed Status -->
  <div class="panel">
    <h2>Market Feed</h2>
    <div class="row">
      <span class="status-dot" id="feed-dot"></span>
      <span id="feed-status">Disconnected</span>
      <span style="margin-left:auto; color:#666;" id="event-rate"></span>
    </div>
  </div>

  <!-- Top Markets -->
  <div class="panel">
    <h2>Top Markets <span style="color:#666; font-size:12px;">(click to pin)</span></h2>
    <div id="markets-list"></div>
  </div>

  <!-- Log -->
  <div id="log"></div>
</div>

<script>
const API = '';
let lastStatus = null;

function log(msg) {
  const el = document.getElementById('log');
  const t = new Date().toLocaleTimeString();
  el.innerHTML += '<div class="log-entry">[' + t + '] ' + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}

async function api(path, method='GET', body=null) {
  const opts = { method, headers: {'Content-Type': 'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  return r.json();
}

async function startAudio() {
  const track = document.getElementById('track-select').value;
  log('Starting audio: ' + track);
  const r = await api('/api/start', 'POST', {track});
  if (r.ok) log('Audio started on port ' + r.osc_port);
  else log('ERROR: ' + r.error);
}

async function stopAudio() {
  log('Stopping audio...');
  const r = await api('/api/stop', 'POST');
  if (r.ok) log('Audio stopped');
  else log('ERROR: ' + r.error);
}

async function changeTrack() {
  const track = document.getElementById('track-select').value;
  log('Switching track: ' + track);
  const r = await api('/api/track', 'POST', {track});
  if (r.ok) log('Track switched to ' + r.track);
  else log('ERROR: ' + r.error);
}

async function pinMarket(slug) {
  log('Pinning: ' + slug);
  const r = await api('/api/pin', 'POST', {slug});
  if (r.ok) log('Pinned: ' + slug);
  else log('ERROR: ' + r.error);
}

async function unpinMarket() {
  log('Switching to autonomous mode');
  const r = await api('/api/unpin', 'POST');
  if (r.ok) log('Autonomous mode');
}

function heatColor(h) {
  if (h > 0.8) return '#ff4444';
  if (h > 0.5) return '#ffaa00';
  return '#00aaff';
}

function updateUI(s) {
  // Audio
  document.getElementById('audio-dot').className = 'status-dot ' + (s.audio_running ? 'dot-on' : 'dot-off');
  document.getElementById('audio-status').textContent = s.audio_running ? 'Running: ' + (s.current_track || '?') : 'Stopped';

  // Tracks
  const sel = document.getElementById('track-select');
  if (sel.options.length === 0 && s.tracks) {
    s.tracks.forEach(t => { const o = new Option(t, t); sel.add(o); });
  }

  // Feed
  document.getElementById('feed-dot').className = 'status-dot ' + (s.feed_running ? 'dot-on' : 'dot-off');
  document.getElementById('feed-status').textContent = s.feed_running ? 'Connected' : 'Disconnected';
  document.getElementById('event-rate').textContent = s.event_rate ? s.event_rate + ' total events' : '';

  // Current market
  const cp = document.getElementById('current-panel');
  if (s.current_market) {
    cp.style.display = '';
    document.getElementById('current-market-name').textContent = s.current_market.question;
    const mood = document.getElementById('current-mood');
    mood.textContent = s.current_market.tone === 'bullish'
      ? 'BULLISH ' + (s.current_market.price * 100).toFixed(1) + '%'
      : 'BEARISH ' + (s.current_market.price * 100).toFixed(1) + '%';
    mood.className = 'mood ' + s.current_market.tone;

    // OSC params
    if (s.current_market.osc) {
      const o = s.current_market.osc;
      document.getElementById('osc-params').innerHTML = [
        ['AMP', o.amp], ['CUTOFF', o.cutoff], ['REVERB', o.reverb],
        ['DENSITY', o.density], ['TENSION', o.tension], ['HEAT', s.current_market.heat]
      ].map(([l,v]) => '<div class="osc-param"><div class="label">'+l+'</div><div class="value">'+v+'</div></div>').join('');
    }

    // Pinned badge
    const pb = document.getElementById('pinned-badge');
    pb.innerHTML = s.pinned
      ? '<span class="badge badge-blue">PINNED: ' + s.pinned + '</span>'
      : '<span class="badge badge-green">AUTONOMOUS</span>';
  } else {
    cp.style.display = 'none';
  }

  // Markets list
  const ml = document.getElementById('markets-list');
  if (s.top_markets && s.top_markets.length) {
    ml.innerHTML = s.top_markets.map((m, i) => {
      const pct = Math.round(m.heat * 100);
      const col = heatColor(m.heat);
      return '<div class="market-card' + (m.playing ? ' playing' : '') + '" onclick="pinMarket(\\''+m.slug+'\\')"><div class="market-question">'
        + (m.playing ? '>> ' : (i+1) + '. ')
        + m.question.substring(0, 65) + '</div>'
        + '<div class="market-meta">'
        + '<span>Heat: <span class="heat-bar"><span class="heat-fill" style="width:'+pct+'%;background:'+col+'"></span></span> '+m.heat.toFixed(2)+'</span>'
        + '<span>Vol: $' + (m.volume/1000).toFixed(0) + 'k</span>'
        + (m.playing ? '<span class="badge badge-green">PLAYING</span>' : '')
        + '</div></div>';
    }).join('');
  }
}

// Poll status
setInterval(async () => {
  try {
    const s = await api('/api/status');
    updateUI(s);
    lastStatus = s;
  } catch(e) {}
}, 1500);

log('Dashboard loaded. Click Start to begin.');
</script>
</body>
</html>
"""


# ── App setup ─────────────────────────────────────────────

async def on_startup(app):
    """Start Polymarket feed and DJ on server boot."""
    import polymarket.gamma as gamma_module

    state.osc = OSCBridge(state.scorer)
    state.dj = AutonomousDJ(state.scorer, None, state.osc, gamma_module)
    state.feed = PolymarketFeed(state.scorer, on_resolution=state.dj.on_market_resolved)
    state.dj.feed = state.feed

    print("[SERVER] Starting Polymarket feed...", flush=True)
    state._feed_task = asyncio.create_task(feed_loop())
    state._dj_task = asyncio.create_task(dj_loop())
    print("[SERVER] Feed and DJ started.", flush=True)


async def on_shutdown(app):
    """Clean shutdown."""
    for task in [state._feed_task, state._dj_task, state._push_task]:
        if task:
            task.cancel()
    if state.sonic:
        await state.sonic.shutdown()
    print("[SERVER] Shut down.", flush=True)


def create_app():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    app.router.add_get("/", handle_index)
    app.router.add_get("/api/status", handle_status)
    app.router.add_post("/api/start", handle_start_audio)
    app.router.add_post("/api/stop", handle_stop_audio)
    app.router.add_post("/api/track", handle_change_track)
    app.router.add_post("/api/pin", handle_pin_market)
    app.router.add_post("/api/unpin", handle_unpin)

    return app


if __name__ == "__main__":
    print("""
    +==========================================+
    |    THE POLYMARKET BAR -- CONTROL PANEL    |
    |    http://localhost:8888                  |
    +==========================================+
    """, flush=True)
    app = create_app()
    web.run_app(app, host="127.0.0.1", port=8888, print=lambda msg: print(f"[SERVER] {msg}", flush=True))
