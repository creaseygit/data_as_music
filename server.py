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
                amp = _scale(heat, 0, 1, 0.1, 0.8)
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
            "autonomous": self.dj.autonomous if self.dj else False,
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
    """Push params via both run_code (direct set) and OSC."""
    try:
        while True:
            await asyncio.sleep(interval)
            if state.dj and state.dj.current_asset and state.audio_running and state.sonic:
                aid = state.dj.current_asset
                scorer = state.scorer

                heat = scorer.heat(aid)
                vel = scorer.price_velocity(aid)
                rate = scorer.trade_rate(aid)
                bid, ask = scorer.spreads.get(aid, (0.4, 0.6))
                prices = list(scorer.price_history.get(aid, []))
                last_price = prices[-1][1] if prices else 0.5

                amp = _scale(heat, 0, 1, 0.1, 0.8)
                cutoff = _scale(last_price, 0, 1, 60, 115)
                reverb = _scale(vel, 0, 1, 0.1, 0.85)
                density = _scale(rate, 0, 1, 0.1, 1.0)
                tone = 1 if last_price >= 0.5 else 0
                tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)

                # Push via run_code — guaranteed to update get() state
                code = ""
                for layer in ["kick", "bass", "pad", "lead", "atmos"]:
                    code += (
                        f'set :{layer}_amp, {amp:.3f}; '
                        f'set :{layer}_cutoff, {cutoff:.1f}; '
                        f'set :{layer}_reverb, {reverb:.3f}; '
                        f'set :{layer}_density, {density:.3f}; '
                        f'set :{layer}_tone, {tone}; '
                        f'set :{layer}_tension, {tension:.3f}\n'
                    )
                try:
                    await state.sonic.run_code(code)
                except Exception:
                    pass

                # Also push via OSC for any sync listeners
                for slot in LAYER_INSTRUMENTS:
                    try:
                        state.osc.push_market_params(slot, aid)
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


async def handle_test_sound(request):
    """Play a test sound to verify audio is working."""
    if not state.sonic or not state.audio_running:
        return web.json_response({"error": "Audio not running"}, status=400)

    data = await request.json() if request.content_length else {}
    test_type = data.get("type", "beep")

    if test_type == "beep":
        await state.sonic.run_code("""
use_synth :beep
play :c5, amp: 2, release: 0.5
sleep 0.3
play :e5, amp: 2, release: 0.5
sleep 0.3
play :g5, amp: 2, release: 0.5
""")
    elif test_type == "kick":
        await state.sonic.run_code("""
3.times do
  sample :bd_haus, amp: 2
  sleep 0.5
end
""")
    elif test_type == "all_layers":
        # Set layer state directly via run_code AND send OSC
        await state.sonic.run_code("""
[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  set :"#{layer}_amp", 1.0
  set :"#{layer}_cutoff", 85.0
  set :"#{layer}_reverb", 0.4
  set :"#{layer}_density", 0.6
  set :"#{layer}_tone", 1
  set :"#{layer}_tension", 0.2
end
""")
        # Also send via OSC for any listeners
        from pythonosc import udp_client
        osc = udp_client.SimpleUDPClient("127.0.0.1", state.sonic.osc_cues_port)
        for layer in ["kick", "bass", "pad", "lead", "atmos"]:
            osc.send_message(f"/btc/{layer}/amp", 1.0)
            osc.send_message(f"/btc/{layer}/cutoff", 85.0)
            osc.send_message(f"/btc/{layer}/reverb", 0.4)
            osc.send_message(f"/btc/{layer}/density", 0.6)
            osc.send_message(f"/btc/{layer}/tone", 1)
            osc.send_message(f"/btc/{layer}/tension", 0.2)

    return web.json_response({"ok": True, "test": test_type})


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
    """Unpin market."""
    if state.dj:
        state.dj.unpin()
        return web.json_response({"ok": True})
    return web.json_response({"error": "DJ not running"}, status=400)


async def handle_autonomous(request):
    """Toggle autonomous mode."""
    data = await request.json()
    enabled = data.get("enabled", False)
    if state.dj:
        state.dj.set_autonomous(enabled)
        return web.json_response({"ok": True, "autonomous": enabled})
    return web.json_response({"error": "DJ not running"}, status=400)


async def handle_kill_all(request):
    """Emergency kill: stop audio and kill all orphaned scsynth/ruby processes."""
    import subprocess as sp

    # Stop our own audio first
    if state._push_task:
        state._push_task.cancel()
        state._push_task = None
    if state.sonic:
        await state.sonic.shutdown()
        state.sonic = None
    state.audio_running = False
    state.current_track = None

    # Kill any orphaned processes
    killed = []
    for proc_name in ["scsynth.exe", "ruby.exe"]:
        try:
            result = sp.run(["taskkill", "/F", "/IM", proc_name],
                          capture_output=True, text=True)
            if "SUCCESS" in result.stdout:
                count = result.stdout.count("SUCCESS")
                killed.append(f"{proc_name}: {count}")
        except Exception:
            pass

    msg = f"Killed: {', '.join(killed)}" if killed else "No orphaned processes found"
    print(f"[SERVER] Kill all: {msg}", flush=True)
    return web.json_response({"ok": True, "message": msg})


async def handle_index(request):
    return web.Response(text=HTML_PAGE, content_type="text/html")


# ── HTML UI ───────────────────────────────────────────────

HTML_PAGE = r"""<!DOCTYPE html>
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
  .panel h2 { color: #00aaff; font-size: 15px; margin-bottom: 12px; }

  .row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }

  button {
    background: #1a1a2e; color: #00ff88; border: 1px solid #00ff88;
    padding: 8px 16px; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 13px; transition: all 0.15s;
  }
  button:hover { background: #00ff88; color: #0a0a0f; }
  button.danger { border-color: #ff4444; color: #ff4444; }
  button.danger:hover { background: #ff4444; color: #0a0a0f; }
  button.active { background: #00ff88; color: #0a0a0f; font-weight: bold; }
  button.active-blue { background: #00aaff; color: #0a0a0f; border-color: #00aaff; }
  button:disabled { opacity: 0.3; cursor: default; }

  select {
    background: #1a1a2e; color: #e0e0e0; border: 1px solid #333;
    padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 13px;
  }

  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot-on { background: #00ff88; box-shadow: 0 0 8px #00ff88; }
  .dot-off { background: #333; }

  .market-card {
    background: #0d0d15; border: 1px solid #1a1a2e; border-radius: 6px;
    padding: 12px 14px; margin-bottom: 6px; cursor: pointer;
    transition: all 0.15s; display: flex; align-items: center; gap: 12px;
  }
  .market-card:hover { border-color: #00aaff; background: #0f0f1a; }
  .market-card.playing { border-color: #00ff88; background: #081a0e; }
  .market-rank { color: #444; font-size: 12px; min-width: 22px; }
  .market-body { flex: 1; min-width: 0; }
  .market-question { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .market-meta { font-size: 11px; color: #555; margin-top: 3px; display: flex; gap: 14px; }
  .market-play-badge { color: #00ff88; font-size: 11px; font-weight: bold; white-space: nowrap; }

  .heat-bar { width: 50px; height: 5px; background: #1a1a2e; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; }
  .heat-fill { height: 100%; border-radius: 3px; }

  .now-playing {
    background: #081a0e; border: 1px solid #00ff88; border-radius: 8px;
    padding: 16px; margin-bottom: 16px;
  }
  .np-question { font-size: 16px; color: #00ff88; margin-bottom: 8px; }
  .np-mood { font-size: 22px; font-weight: bold; margin: 8px 0; }
  .np-mood.bullish { color: #00ff88; }
  .np-mood.bearish { color: #ff6644; }

  .osc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
  .osc-cell { background: #0a0a12; padding: 8px; border-radius: 4px; text-align: center; }
  .osc-cell .lbl { font-size: 10px; color: #555; text-transform: uppercase; }
  .osc-cell .val { font-size: 18px; color: #00aaff; }

  .mode-toggle { display: flex; border: 1px solid #333; border-radius: 4px; overflow: hidden; }
  .mode-toggle button { border: none; border-radius: 0; flex: 1; }
  .mode-toggle button:first-child { border-right: 1px solid #333; }

  #log {
    background: #08080c; border: 1px solid #1a1a2e; border-radius: 4px;
    padding: 10px; height: 100px; overflow-y: auto; font-size: 11px; color: #444; margin-top: 10px;
  }
</style>
</head>
<body>
<div class="container">
  <h1>THE POLYMARKET BAR</h1>
  <div class="subtitle">One market. One mood. Real-time.</div>

  <!-- Audio Engine -->
  <div class="panel">
    <h2>Audio</h2>
    <div class="row">
      <span class="dot" id="audio-dot"></span>
      <span id="audio-label">Stopped</span>
      <select id="track-select"></select>
      <button onclick="startAudio()">Start</button>
      <button class="danger" onclick="stopAudio()">Stop</button>
      <button onclick="changeTrack()">Switch Track</button>
      <button class="danger" onclick="killAll()" style="margin-left:auto;">Kill All</button>
    </div>
    <div class="row" id="test-row" style="display:none;">
      <span style="color:#555;">Test:</span>
      <button onclick="testSound('beep')">Beep</button>
      <button onclick="testSound('kick')">Kick</button>
      <button onclick="testSound('all_layers')">All Layers On</button>
    </div>
  </div>

  <!-- Now Playing -->
  <div class="now-playing" id="np" style="display:none">
    <div class="np-question" id="np-question"></div>
    <div class="np-mood" id="np-mood"></div>
    <div class="osc-grid" id="np-osc"></div>
  </div>

  <!-- Mode + Feed -->
  <div class="panel">
    <div class="row">
      <span class="dot" id="feed-dot"></span>
      <span id="feed-label">Feed: disconnected</span>
      <span style="margin-left:auto; color:#555;" id="event-count"></span>
    </div>
    <div class="row" style="margin-top:10px;">
      <span style="color:#666; margin-right:4px;">Mode:</span>
      <div class="mode-toggle">
        <button id="btn-manual" onclick="setMode(false)">Manual</button>
        <button id="btn-auto" onclick="setMode(true)">Autonomous</button>
      </div>
    </div>
  </div>

  <!-- Markets -->
  <div class="panel">
    <h2>Markets <span style="color:#555; font-weight:normal; font-size:12px;">click to play</span></h2>
    <div id="markets"></div>
  </div>

  <div id="log"></div>
</div>

<script>
let lastStatus = null;

function log(msg) {
  const el = document.getElementById('log');
  const t = new Date().toLocaleTimeString();
  el.innerHTML += '<div>[' + t + '] ' + msg + '</div>';
  el.scrollTop = el.scrollHeight;
}

async function api(path, method='GET', body=null) {
  const opts = { method, headers: {'Content-Type': 'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

async function startAudio() {
  const track = document.getElementById('track-select').value;
  log('Starting: ' + track);
  const r = await api('/api/start', 'POST', {track});
  r.ok ? log('Audio on, port ' + r.osc_port) : log('ERR: ' + r.error);
}

async function stopAudio() {
  const r = await api('/api/stop', 'POST');
  r.ok ? log('Audio stopped') : log('ERR: ' + r.error);
}

async function changeTrack() {
  const track = document.getElementById('track-select').value;
  const r = await api('/api/track', 'POST', {track});
  r.ok ? log('Track: ' + r.track) : log('ERR: ' + r.error);
}

async function testSound(type) {
  log('Test: ' + type);
  const r = await api('/api/test-sound', 'POST', {type});
  r.ok ? log('Test sound: ' + type) : log('ERR: ' + r.error);
}

async function killAll() {
  const r = await api('/api/kill-all', 'POST');
  r.ok ? log(r.message) : log('ERR: ' + r.error);
}

async function playMarket(slug) {
  log('Playing: ' + slug);
  const r = await api('/api/pin', 'POST', {slug});
  r.ok ? log('Now playing: ' + slug) : log('ERR: ' + r.error);
}

async function setMode(auto) {
  const r = await api('/api/autonomous', 'POST', {enabled: auto});
  r.ok ? log(auto ? 'Autonomous mode' : 'Manual mode') : log('ERR: ' + r.error);
}

function heatColor(h) {
  if (h > 0.8) return '#ff4444';
  if (h > 0.5) return '#ffaa00';
  return '#00aaff';
}

function updateUI(s) {
  // Audio
  const ad = document.getElementById('audio-dot');
  ad.className = 'dot ' + (s.audio_running ? 'dot-on' : 'dot-off');
  document.getElementById('audio-label').textContent = s.audio_running ? 'Playing: ' + s.current_track : 'Stopped';
  document.getElementById('test-row').style.display = s.audio_running ? '' : 'none';

  // Track dropdown
  const sel = document.getElementById('track-select');
  if (sel.options.length === 0 && s.tracks) {
    s.tracks.forEach(t => sel.add(new Option(t, t)));
  }

  // Feed
  document.getElementById('feed-dot').className = 'dot ' + (s.feed_running ? 'dot-on' : 'dot-off');
  document.getElementById('feed-label').textContent = s.feed_running ? 'Feed: connected' : 'Feed: disconnected';
  document.getElementById('event-count').textContent = s.event_rate ? s.event_rate + ' events' : '';

  // Mode buttons
  document.getElementById('btn-manual').className = s.autonomous ? '' : 'active';
  document.getElementById('btn-auto').className = s.autonomous ? 'active-blue' : '';

  // Now playing
  const np = document.getElementById('np');
  if (s.current_market) {
    np.style.display = '';
    document.getElementById('np-question').textContent = s.current_market.question;
    const mood = document.getElementById('np-mood');
    const pct = (s.current_market.price * 100).toFixed(1);
    mood.textContent = s.current_market.tone.toUpperCase() + '  ' + pct + '%';
    mood.className = 'np-mood ' + s.current_market.tone;

    if (s.current_market.osc) {
      const o = s.current_market.osc;
      document.getElementById('np-osc').innerHTML = [
        ['AMP', o.amp], ['CUTOFF', o.cutoff], ['REVERB', o.reverb],
        ['DENSITY', o.density], ['TENSION', o.tension], ['HEAT', s.current_market.heat]
      ].map(([l,v]) =>
        '<div class="osc-cell"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>'
      ).join('');
    }
  } else {
    np.style.display = 'none';
  }

  // Market list
  const ml = document.getElementById('markets');
  if (s.top_markets && s.top_markets.length) {
    ml.innerHTML = s.top_markets.map((m, i) => {
      const pct = Math.round(m.heat * 100);
      const col = heatColor(m.heat);
      const cls = m.playing ? 'market-card playing' : 'market-card';
      const slug = m.slug.replace(/'/g, "\\'");
      return '<div class="' + cls + '" onclick="playMarket(\'' + slug + '\')">'
        + '<div class="market-rank">' + (i+1) + '</div>'
        + '<div class="market-body">'
        + '<div class="market-question">' + m.question.substring(0, 70) + '</div>'
        + '<div class="market-meta">'
        + '<span><span class="heat-bar"><span class="heat-fill" style="width:'+pct+'%;background:'+col+'"></span></span> '+m.heat.toFixed(2)+'</span>'
        + '<span>$' + (m.volume/1000).toFixed(0) + 'k</span>'
        + '</div></div>'
        + (m.playing ? '<div class="market-play-badge">PLAYING</div>' : '')
        + '</div>';
    }).join('');
  }
}

setInterval(async () => {
  try { const s = await api('/api/status'); updateUI(s); lastStatus = s; } catch(e) {}
}, 1500);

log('Ready. Start audio, then click a market to play.');
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
    app.router.add_post("/api/test-sound", handle_test_sound)
    app.router.add_post("/api/stop", handle_stop_audio)
    app.router.add_post("/api/track", handle_change_track)
    app.router.add_post("/api/pin", handle_pin_market)
    app.router.add_post("/api/unpin", handle_unpin)
    app.router.add_post("/api/autonomous", handle_autonomous)
    app.router.add_post("/api/kill-all", handle_kill_all)

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
