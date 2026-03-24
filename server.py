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
from config import RESCORE_INTERVAL, LAYER_INSTRUMENTS, BROWSE_CATEGORIES


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
        self._price_task = None

        # Smoothing state for per-layer param differentiation
        self._smooth_density = 0.5
        self._smooth_cutoff = 80.0
        self._prev_heat = 0.0
        self._prev_price = 0.5
        self._current_tone = 1

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

            # Display price: prefer WebSocket bid/ask midpoint (real-time),
            # fall back to API outcome_prices (can be stale on fast markets)
            api_price = self._get_api_price(self.dj.current_market, aid)
            ws_mid = None
            if bid != 0.4 or ask != 0.6:  # not the default — real WS data
                ws_mid = (bid + ask) / 2.0
            display_price = ws_mid if ws_mid is not None else (api_price if api_price is not None else 0.5)

            market_info = {
                "question": self.dj.current_market["question"],
                "slug": self.dj.current_market.get("slug", ""),
                "event_slug": self.dj.current_market.get("event_slug", ""),
                "heat": round(heat, 3),
                "price": round(display_price, 4),
                "velocity": round(vel, 4),
                "trade_rate": round(rate, 3),
                "spread": round(ask - bid, 4),
                "tone": "bullish" if self._current_tone == 1 else "bearish",
            }

            # OSC params being sent (base values — layers differ)
            if aid:
                amp = _scale(heat, 0, 1, 0.1, 0.8)
                cutoff = _scale(display_price, 0, 1, 60, 115)
                reverb = _scale(vel, 0, 1, 0.1, 0.85)
                density = _scale(rate, 0, 1, 0.1, 1.0)
                tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)
                swing = tension * 0.06
                market_info["osc"] = {
                    "amp": round(amp, 2),
                    "cutoff": round(cutoff, 1),
                    "reverb": round(reverb, 2),
                    "density": round(density, 2),
                    "tension": round(tension, 2),
                    "swing": round(swing, 3),
                }

        return {
            "audio_running": self.audio_running,
            "feed_running": self.feed_running,
            "current_track": self.current_track,
            "tracks": list(self.tracks.keys()),
            "autonomous": self.dj.autonomous if self.dj else False,
            "pinned": self.dj.pinned_slug if self.dj else None,
            "current_market": market_info,
            "event_rate": self._get_event_rate(),
        }

    @staticmethod
    def _get_api_price(market: dict, asset_id: str) -> float | None:
        """Get the API-reported price for an asset_id (matches Polymarket display)."""
        asset_ids = market.get("asset_ids", [])
        outcome_prices = market.get("outcome_prices", [])
        if asset_id in asset_ids and len(outcome_prices) == len(asset_ids):
            idx = asset_ids.index(asset_id)
            return outcome_prices[idx]
        return None

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
    """Push per-layer params with differentiation, smoothing, and event detection."""
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
                spread = ask - bid
                # Prefer WebSocket bid/ask midpoint (real-time), fall back to API
                api_price = state._get_api_price(state.dj.current_market, aid) if state.dj.current_market else None
                ws_mid = None
                if bid != 0.4 or ask != 0.6:  # not default — real WS data
                    ws_mid = (bid + ask) / 2.0
                last_price = ws_mid if ws_mid is not None else (api_price if api_price is not None else 0.5)

                # Base values
                amp = _scale(heat, 0, 1, 0.1, 0.8)
                cutoff = _scale(last_price, 0, 1, 60, 115)
                reverb = _scale(vel, 0, 1, 0.1, 0.85)
                density = _scale(rate, 0, 1, 0.1, 1.0)
                tension = _scale(spread, 0, 0.3, 0.0, 1.0)

                # Tone with hysteresis — prevent flickering near 0.50
                if state._current_tone == 1 and last_price < 0.45:
                    state._current_tone = 0
                elif state._current_tone == 0 and last_price > 0.55:
                    state._current_tone = 1
                tone = state._current_tone

                # EMA smoothing for atmos (slow-reacting layer)
                alpha = 0.15
                state._smooth_density = state._smooth_density * (1 - alpha) + density * alpha
                state._smooth_cutoff = state._smooth_cutoff * (1 - alpha) + cutoff * alpha

                # Swing derived from tension (0.0 – 0.06)
                swing = tension * 0.06

                # ── Event detection ──────────────────────────
                heat_delta = abs(heat - state._prev_heat)
                price_delta = abs(last_price - state._prev_price)
                event_code = ""
                if heat_delta > 0.15:
                    event_code += "set :event_spike, 1\n"
                if price_delta > 0.03:
                    direction = 1 if last_price > state._prev_price else -1
                    event_code += f"set :event_price_move, {direction}\n"
                if event_code:
                    print(f"[EVENT] heat_delta={heat_delta:.3f} price_delta={price_delta:.4f}", flush=True)
                state._prev_heat = heat
                state._prev_price = last_price

                # Log data state every push
                tone_str = "major" if tone == 1 else "minor"
                print(f"[PARAMS] price={last_price:.4f} heat={heat:.3f} vel={vel:.4f} rate={rate:.3f} spread={spread:.4f} tone={tone_str}", flush=True)

                # ── Per-layer differentiation ────────────────
                layer_params = {
                    "kick": {
                        "amp": amp,
                        "cutoff": max(cutoff - 20, 60),
                        "reverb": reverb * 0.3,
                        "density": density,
                        "tone": tone,
                        "tension": tension,
                        "swing": swing,
                    },
                    "bass": {
                        "amp": amp * 0.9,
                        "cutoff": max(cutoff - 15, 60),
                        "reverb": reverb * 0.2,
                        "density": density,
                        "tone": tone,
                        "tension": tension,
                        "swing": 0.0,
                    },
                    "pad": {
                        "amp": _scale(amp, 0.1, 0.8, 0.3, 0.7),
                        "cutoff": cutoff,
                        "reverb": min(reverb * 1.3, 0.85),
                        "density": max(1.0 - (density * 0.5), 0.3),
                        "tone": tone,
                        "tension": tension,
                        "swing": 0.0,
                    },
                    "lead": {
                        "amp": amp * 0.8 if density > 0.3 else 0.0,
                        "cutoff": min(cutoff + 10, 115),
                        "reverb": reverb,
                        "density": max(density - 0.15, 0.1),
                        "tone": tone,
                        "tension": tension,
                        "swing": 0.0,
                    },
                    "atmos": {
                        "amp": amp * 0.5,
                        "cutoff": state._smooth_cutoff,
                        "reverb": min(reverb * 1.5, 0.85),
                        "density": state._smooth_density,
                        "tone": tone,
                        "tension": tension * 0.7,
                        "swing": 0.0,
                    },
                }

                code = event_code
                for layer, params in layer_params.items():
                    parts = [f"set :{layer}_{k}, {v:.3f}" for k, v in params.items()]
                    code += "; ".join(parts) + "\n"

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


async def price_poll_loop(interval=5.0):
    """Poll Gamma API for current market price every 5s."""
    import polymarket.gamma as gamma_module
    print("[PRICE POLL] Loop started", flush=True)
    try:
        while True:
            await asyncio.sleep(interval)
            if not (state.dj and state.dj.current_market):
                continue
            slug = state.dj.current_market.get("slug")
            if not slug:
                print("[PRICE POLL] No slug on current market", flush=True)
                continue
            try:
                fresh = await asyncio.to_thread(gamma_module.fetch_market_by_slug, slug)
                if fresh and fresh.get("outcome_prices"):
                    old_prices = state.dj.current_market.get("outcome_prices", [])
                    new_prices = fresh["outcome_prices"]
                    state.dj.current_market["outcome_prices"] = new_prices
                    state.dj.current_market["outcomes"] = fresh.get("outcomes", [])
                    if old_prices != new_prices:
                        outcomes = fresh.get("outcomes", [])
                        parts = [f"{outcomes[i]}={new_prices[i]:.4f}" for i in range(len(new_prices)) if i < len(outcomes)]
                        print(f"[PRICE POLL] {slug}: UPDATED {' | '.join(parts)}", flush=True)
                    else:
                        print(f"[PRICE POLL] {slug}: unchanged {new_prices}", flush=True)
                else:
                    print(f"[PRICE POLL] {slug}: no data returned", flush=True)
            except Exception as e:
                print(f"[PRICE POLL] {slug}: error: {e}", flush=True)
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

        # Start background loops
        state._push_task = asyncio.create_task(param_push_loop())
        state._price_task = asyncio.create_task(price_poll_loop())

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

    for t in [state._push_task, state._price_task]:
        if t:
            t.cancel()
    state._push_task = None
    state._price_task = None

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


async def handle_play_url(request):
    """Play a market from a Polymarket URL."""
    from urllib.parse import urlparse
    import polymarket.gamma as gamma_module

    data = await request.json()
    url = (data.get("url") or "").strip()
    if not url:
        return web.json_response({"error": "url required"}, status=400)
    if not state.dj:
        return web.json_response({"error": "DJ not running"}, status=400)

    # Parse URL: /event/{event_slug} or /event/{event_slug}/{market_slug}
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        # Expected: ["event", event_slug] or ["event", event_slug, market_slug]
        if len(parts) < 2 or parts[0] != "event":
            return web.json_response({"error": "Invalid URL format. Expected: polymarket.com/event/..."}, status=400)

        event_slug = parts[1]
        market_slug = parts[2] if len(parts) >= 3 else None
    except Exception:
        return web.json_response({"error": "Could not parse URL"}, status=400)

    try:
        market = None

        # Try market slug first (more specific)
        if market_slug:
            market = gamma_module.fetch_market_by_slug(market_slug)

        # Fall back to event slug — pick the first tradeable market in the event
        if not market:
            event_markets = gamma_module.fetch_markets_by_event_slug(event_slug)
            if event_markets:
                market = event_markets[0]

        if not market or not market.get("asset_ids"):
            return web.json_response({"error": f"No tradeable market found for: {event_slug}"}, status=404)

        # Inject into DJ's market list if not already there
        existing = next((m for m in state.dj.all_markets if m["slug"] == market["slug"]), None)
        if not existing:
            state.dj.all_markets.append(market)
            # Subscribe to its asset IDs
            for aid in market["asset_ids"]:
                state.scorer.set_volume(aid, market["volume"])
            if state.feed:
                new_ids = [aid for aid in market["asset_ids"] if aid not in state.feed.subscribed]
                if new_ids:
                    await state.feed.update_subscriptions(add=new_ids, remove=[])

        # Pin and play
        state.dj.pin_market(market["slug"])
        return web.json_response({"ok": True, "pinned": market["slug"], "question": market["question"]})

    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


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
    for t in [state._push_task, state._price_task]:
        if t:
            t.cancel()
    state._push_task = None
    state._price_task = None
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


async def handle_browse(request):
    """Browse markets by category."""
    import polymarket.gamma as gamma_module
    tag_id = request.query.get("tag_id")
    sort = request.query.get("sort", "volume")
    limit = int(request.query.get("limit", "10"))
    try:
        tag_id_int = int(tag_id) if tag_id else None
        markets = gamma_module.fetch_browse_markets(tag_id=tag_id_int, limit=limit, sort=sort)
        from mixer.mixer import AutonomousDJ
        result = []
        for m in markets:
            prices = m.get("outcome_prices", [])
            outcomes = m.get("outcomes", [])
            # Find primary (Yes/Up) outcome price
            primary_price = None
            if prices and outcomes and len(prices) == len(outcomes):
                for i, name in enumerate(outcomes):
                    if name.lower() in ("yes", "up"):
                        primary_price = prices[i]
                        break
            if primary_price is None and prices:
                primary_price = prices[0]
            result.append({
                "question": m["question"],
                "slug": m["slug"],
                "event_slug": m.get("event_slug", ""),
                "volume": m.get("volume", 0),
                "price": round(primary_price, 4) if primary_price is not None else None,
                "end_date": m.get("end_date"),
            })
        return web.json_response({"ok": True, "markets": result})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_categories(request):
    """Return available browse categories."""
    return web.json_response({"categories": BROWSE_CATEGORIES})


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
  .market-link { color: #00aaff; text-decoration: none; font-size: 16px; padding: 6px 10px; border: 1px solid #1a1a2e; border-radius: 4px; transition: all 0.15s; white-space: nowrap; }
  .market-link:hover { color: #fff; background: #00aaff22; border-color: #00aaff; }
  .market-tags { font-size: 10px; color: #444; }

  .url-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .url-row input {
    flex: 1; background: #1a1a2e; color: #e0e0e0; border: 1px solid #333;
    padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 13px;
  }
  .url-row input::placeholder { color: #444; }
  .url-row input:focus { outline: none; border-color: #00aaff; }
  .url-status { font-size: 11px; color: #555; margin-bottom: 8px; min-height: 16px; }

  .browse-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .browse-tab {
    background: #1a1a2e; color: #888; border: 1px solid #222; border-radius: 4px;
    padding: 5px 12px; cursor: pointer; font-family: inherit; font-size: 12px; transition: all 0.15s;
  }
  .browse-tab:hover { border-color: #00aaff; color: #ccc; }
  .browse-tab.active { background: #00aaff22; border-color: #00aaff; color: #00aaff; }
  .browse-loading { color: #444; font-size: 12px; padding: 10px 0; }
  .browse-card {
    background: #0d0d15; border: 1px solid #1a1a2e; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 5px; display: flex; align-items: center; gap: 10px;
    transition: all 0.15s;
  }
  .browse-card:hover { border-color: #333; }
  .browse-body { flex: 1; min-width: 0; }
  .browse-question { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #ccc; }
  .browse-meta { font-size: 11px; color: #555; margin-top: 2px; }
  .browse-price { color: #00aaff; font-size: 14px; font-weight: bold; min-width: 45px; text-align: right; }
  .browse-play { padding: 4px 10px; font-size: 11px; }
  .user-card { cursor: pointer; }
  .user-card.playing { border-color: #00ff88; background: #081a0e; }

  .heat-bar { width: 50px; height: 5px; background: #1a1a2e; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; }
  .heat-fill { height: 100%; border-radius: 3px; }

  .now-playing {
    background: #081a0e; border: 1px solid #00ff88; border-radius: 8px;
    padding: 16px; margin-bottom: 16px;
  }
  .np-header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
  .np-question { font-size: 16px; color: #00ff88; flex: 1; }
  .np-link { color: #00aaff; text-decoration: none; font-size: 14px; padding: 4px 10px; border: 1px solid #00aaff44; border-radius: 4px; white-space: nowrap; transition: all 0.15s; }
  .np-link:hover { background: #00aaff22; border-color: #00aaff; color: #fff; }
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
    <div class="np-header">
      <div class="np-question" id="np-question"></div>
      <a class="np-link" id="np-link" href="#" target="_blank" rel="noopener">View on Polymarket &#x2197;</a>
    </div>
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
    <h2>Markets</h2>
    <div class="url-row">
      <input type="text" id="url-input" placeholder="Paste Polymarket URL to play..." onkeydown="if(event.key==='Enter')playUrl()">
      <button onclick="playUrl()">Play URL</button>
    </div>
    <div class="url-status" id="url-status"></div>

    <div id="user-markets-section" style="display:none;">
      <div class="row" style="margin-bottom:6px;">
        <span style="color:#666; font-size:12px;">Your Markets</span>
        <button style="margin-left:auto; padding:3px 8px; font-size:11px; border-color:#444; color:#666;" onclick="clearUserMarkets()">Clear</button>
      </div>
      <div id="user-markets"></div>
    </div>

    <div style="margin-top:14px;">
      <div id="browse-tabs" class="browse-tabs"></div>
      <div id="browse-results" style="margin-top:8px;"></div>
    </div>
  </div>

  <div id="log"></div>
</div>

<script>
let lastStatus = null;
let userMarkets = [];
let browseCache = {};
let activeTab = null;

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
async function setMode(auto) {
  const r = await api('/api/autonomous', 'POST', {enabled: auto});
  r.ok ? log(auto ? 'Autonomous mode' : 'Manual mode') : log('ERR: ' + r.error);
}

// ── URL play ──
async function playUrl() {
  const input = document.getElementById('url-input');
  const status = document.getElementById('url-status');
  const url = input.value.trim();
  if (!url) return;
  status.textContent = 'Loading...';
  status.style.color = '#00aaff';
  try {
    const r = await api('/api/play-url', 'POST', {url});
    if (r.ok) {
      status.textContent = '';
      input.value = '';
      addUserMarket({slug: r.pinned, question: r.question});
      log('Playing URL: ' + r.question);
    } else {
      status.textContent = 'Error: ' + r.error;
      status.style.color = '#ff4444';
    }
  } catch(e) {
    status.textContent = 'Failed to load URL';
    status.style.color = '#ff4444';
  }
}

// ── Play from browse or user list ──
async function playMarket(slug, question, eventSlug) {
  const r = await api('/api/pin', 'POST', {slug});
  if (r.ok) {
    addUserMarket({slug, question, event_slug: eventSlug});
    log('Playing: ' + (question || slug));
  } else {
    log('ERR: ' + r.error);
  }
}

async function playBrowseMarket(slug, question, eventSlug) {
  const r = await api('/api/play-url', 'POST', {url: 'https://polymarket.com/event/' + (eventSlug || slug)});
  if (r.ok) {
    addUserMarket({slug: r.pinned, question: r.question, event_slug: eventSlug});
    log('Playing: ' + r.question);
  } else {
    log('ERR: ' + r.error);
  }
}

// ── User markets ──
function addUserMarket(m) {
  if (!userMarkets.find(u => u.slug === m.slug)) {
    userMarkets.unshift(m);
  }
  renderUserMarkets();
}
function clearUserMarkets() {
  userMarkets = [];
  renderUserMarkets();
}
function renderUserMarkets() {
  const section = document.getElementById('user-markets-section');
  const container = document.getElementById('user-markets');
  if (!userMarkets.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const playing = lastStatus && lastStatus.pinned;
  container.innerHTML = userMarkets.map(m => {
    const isPlaying = playing === m.slug;
    const cls = isPlaying ? 'browse-card user-card playing' : 'browse-card user-card';
    const slug = (m.slug||'').replace(/'/g, "\\'");
    const q = (m.question||'').replace(/'/g, "\\'");
    const es = (m.event_slug||m.slug||'').replace(/'/g, "\\'");
    const link = es ? 'https://polymarket.com/event/' + es : '';
    return '<div class="' + cls + '" onclick="playMarket(\'' + slug + '\',\'' + q + '\',\'' + es + '\')">'
      + '<div class="browse-body">'
      + '<div class="browse-question">' + (m.question||m.slug).substring(0,70) + '</div>'
      + '</div>'
      + (link ? '<a class="market-link" href="' + link + '" target="_blank" rel="noopener" onclick="event.stopPropagation();">View &#x2197;</a>' : '')
      + (isPlaying ? '<div class="market-play-badge">PLAYING</div>' : '')
      + '</div>';
  }).join('');
}

// ── Browse tabs ──
async function initBrowse() {
  const r = await api('/api/categories');
  const tabs = document.getElementById('browse-tabs');
  tabs.innerHTML = (r.categories || []).map(c => {
    const tid = c.tag_id === null ? 'null' : c.tag_id;
    const sort = c.sort || 'volume';
    return '<button class="browse-tab" data-tag="' + tid + '" data-sort="' + sort + '" onclick="browseTab(this)">' + c.label + '</button>';
  }).join('');
  // Auto-click first tab
  const first = tabs.querySelector('.browse-tab');
  if (first) browseTab(first);
}

async function browseTab(btn) {
  document.querySelectorAll('.browse-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tagId = btn.dataset.tag;
  const sort = btn.dataset.sort;
  const cacheKey = tagId + ':' + sort;
  activeTab = cacheKey;

  if (browseCache[cacheKey]) {
    renderBrowse(browseCache[cacheKey]);
    return;
  }

  document.getElementById('browse-results').innerHTML = '<div class="browse-loading">Loading...</div>';
  const params = new URLSearchParams({sort, limit: '10'});
  if (tagId !== 'null') params.set('tag_id', tagId);
  try {
    const r = await api('/api/browse?' + params);
    if (r.ok && activeTab === cacheKey) {
      browseCache[cacheKey] = r.markets;
      renderBrowse(r.markets);
    }
  } catch(e) {
    document.getElementById('browse-results').innerHTML = '<div class="browse-loading">Failed to load</div>';
  }
}

function renderBrowse(markets) {
  const el = document.getElementById('browse-results');
  if (!markets.length) {
    el.innerHTML = '<div class="browse-loading">No markets found</div>';
    return;
  }
  el.innerHTML = markets.map(m => {
    const slug = (m.slug||'').replace(/'/g, "\\'");
    const q = (m.question||'').replace(/'/g, "\\'");
    const es = (m.event_slug||m.slug||'').replace(/'/g, "\\'");
    const link = es ? 'https://polymarket.com/event/' + es : '';
    const pricePct = m.price !== null ? (m.price * 100).toFixed(0) + '%' : '';
    const vol = m.volume > 0 ? '$' + (m.volume/1000).toFixed(0) + 'k' : '';
    return '<div class="browse-card">'
      + '<div class="browse-body">'
      + '<div class="browse-question">' + (m.question||'').substring(0,65) + '</div>'
      + '<div class="browse-meta">' + vol + '</div>'
      + '</div>'
      + (pricePct ? '<div class="browse-price">' + pricePct + '</div>' : '')
      + (link ? '<a class="market-link" href="' + link + '" target="_blank" rel="noopener" onclick="event.stopPropagation();">View &#x2197;</a>' : '')
      + '<button class="browse-play" onclick="event.stopPropagation();playBrowseMarket(\'' + slug + '\',\'' + q + '\',\'' + es + '\')">Play</button>'
      + '</div>';
  }).join('');
}

// ── Status polling ──
function updateUI(s) {
  const ad = document.getElementById('audio-dot');
  ad.className = 'dot ' + (s.audio_running ? 'dot-on' : 'dot-off');
  document.getElementById('audio-label').textContent = s.audio_running ? 'Playing: ' + s.current_track : 'Stopped';
  document.getElementById('test-row').style.display = s.audio_running ? '' : 'none';

  const sel = document.getElementById('track-select');
  if (sel.options.length === 0 && s.tracks) {
    s.tracks.forEach(t => sel.add(new Option(t, t)));
  }

  document.getElementById('feed-dot').className = 'dot ' + (s.feed_running ? 'dot-on' : 'dot-off');
  document.getElementById('feed-label').textContent = s.feed_running ? 'Feed: connected' : 'Feed: disconnected';
  document.getElementById('event-count').textContent = s.event_rate ? s.event_rate + ' events' : '';

  document.getElementById('btn-manual').className = s.autonomous ? '' : 'active';
  document.getElementById('btn-auto').className = s.autonomous ? 'active-blue' : '';

  const np = document.getElementById('np');
  if (s.current_market) {
    np.style.display = '';
    document.getElementById('np-question').textContent = s.current_market.question;
    const npLink = document.getElementById('np-link');
    const npEvtSlug = s.current_market.event_slug || s.current_market.slug || '';
    if (npEvtSlug) {
      npLink.href = 'https://polymarket.com/event/' + npEvtSlug;
      npLink.style.display = '';
    } else { npLink.style.display = 'none'; }
    const mood = document.getElementById('np-mood');
    const pct = (s.current_market.price * 100).toFixed(1);
    mood.textContent = s.current_market.tone.toUpperCase() + '  ' + pct + '%';
    mood.className = 'np-mood ' + s.current_market.tone;
    if (s.current_market.osc) {
      const o = s.current_market.osc;
      document.getElementById('np-osc').innerHTML = [
        ['AMP', o.amp], ['CUTOFF', o.cutoff], ['REVERB', o.reverb],
        ['DENSITY', o.density], ['TENSION', o.tension], ['HEAT', s.current_market.heat]
      ].map(([l,v]) => '<div class="osc-cell"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>').join('');
    }
  } else { np.style.display = 'none'; }

  renderUserMarkets();
}

setInterval(async () => {
  try { const s = await api('/api/status'); updateUI(s); lastStatus = s; } catch(e) {}
}, 1500);

initBrowse();
log('Ready. Start audio, then pick a market to play.');
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
    for task in [state._feed_task, state._dj_task, state._push_task, state._price_task]:
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
    app.router.add_post("/api/play-url", handle_play_url)
    app.router.add_post("/api/unpin", handle_unpin)
    app.router.add_post("/api/autonomous", handle_autonomous)
    app.router.add_post("/api/kill-all", handle_kill_all)
    app.router.add_get("/api/browse", handle_browse)
    app.router.add_get("/api/categories", handle_categories)

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
