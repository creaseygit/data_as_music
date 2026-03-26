"""
The Polymarket DJ — Web Control Panel

Single entry point: boots Sonic Pi headless, connects to Polymarket,
and serves a web UI at http://localhost:8888 for full control.

Controls:
  - Start / Stop music
  - Choose track (.rb file)
  - Pick a market to play from browse tabs or paste a URL
  - View live status
"""
import asyncio
import json
import re
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
from osc.bridge import OSCBridge, _scale
from sonic_pi.headless import SonicPiHeadless
from config import RESCORE_INTERVAL, BROWSE_CATEGORIES


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

        self.master_volume = 0.7

        # Background tasks
        self._feed_task = None
        self._dj_task = None
        self._push_task = None
        self._price_task = None

        # Event detection state
        self._prev_heat = 0.0
        self._prev_price = 0.5
        self._prev_asset = None
        self._current_tone = 1

        # Sandbox mode — manual data control, no market data push
        self.sandbox_mode = False

    @staticmethod
    def _parse_track_meta(filepath):
        """Parse @category and @label from comment lines at the top of an .rb file."""
        meta = {"category": "music", "label": None}
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                if not line.startswith("#"):
                    break
                if m := re.match(r"#\s*@category\s+(\S+)", line):
                    meta["category"] = m.group(1)
                elif m := re.match(r"#\s*@label\s+(.+)", line):
                    meta["label"] = m.group(1).strip()
        return meta

    def _find_tracks(self):
        """Find all .rb track files with metadata."""
        tracks = {}
        for f in sorted(glob.glob("sonic_pi/*.rb")):
            p = Path(f)
            meta = self._parse_track_meta(str(p))
            tracks[p.stem] = {
                "path": str(p),
                "category": meta["category"],
                "label": meta["label"] or p.stem.replace("_", " ").title(),
            }
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

            # Raw data values being pushed to Sonic Pi
            if aid:
                spread_val = ask - bid
                market_info["data"] = {
                    "heat": round(heat, 3),
                    "price": round(display_price, 4),
                    "velocity": round(vel, 4),
                    "trade_rate": round(rate, 3),
                    "spread": round(spread_val, 4),
                    "tone": self._current_tone,
                }

        return {
            "audio_running": self.audio_running,
            "feed_running": self.feed_running,
            "current_track": self.current_track,
            "tracks": [
                {"name": name, "label": info["label"], "category": info["category"]}
                for name, info in self.tracks.items()
            ],
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
    """Push raw normalized market data to Sonic Pi. Tracks interpret it themselves."""
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

                # Normalize to 0-1 ranges
                heat_n = max(0.0, min(1.0, heat))
                price_n = max(0.0, min(1.0, last_price))
                velocity_n = max(0.0, min(1.0, vel))
                trade_rate_n = max(0.0, min(1.0, rate))
                spread_n = _scale(spread, 0, 0.3, 0.0, 1.0)

                # Tone with hysteresis — prevent flickering near 0.50
                if state._current_tone == 1 and last_price < 0.45:
                    state._current_tone = 0
                elif state._current_tone == 0 and last_price > 0.55:
                    state._current_tone = 1
                tone = state._current_tone

                # ── Rotation detection ─────────────────────────
                is_rotation = (aid != state._prev_asset)
                if is_rotation:
                    print(f"[DATA] Market rotated to {aid[:8]}…, suppressing events this cycle", flush=True)
                    state._prev_asset = aid
                    state._prev_heat = heat
                    state._prev_price = last_price
                    state._current_tone = 1 if last_price > 0.5 else 0

                # ── Event detection ──────────────────────────
                event_code = ""
                if not is_rotation:
                    heat_delta = abs(heat - state._prev_heat)
                    price_delta = abs(last_price - state._prev_price)
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
                print(f"[DATA] price={price_n:.4f} heat={heat_n:.3f} vel={velocity_n:.4f} rate={trade_rate_n:.3f} spread={spread_n:.4f} tone={tone_str}", flush=True)

                # ── Push raw data to Sonic Pi ────────────────
                code = event_code
                code += f"set :heat, {heat_n:.4f}\n"
                code += f"set :price, {price_n:.4f}\n"
                code += f"set :velocity, {velocity_n:.4f}\n"
                code += f"set :trade_rate, {trade_rate_n:.4f}\n"
                code += f"set :spread, {spread_n:.4f}\n"
                code += f"set :tone, {tone}\n"

                try:
                    await state.sonic.run_code(code)
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
    if state.sandbox_mode:
        return web.json_response({"error": "Sandbox mode active. Stop sandbox first."}, status=400)
    if state.audio_running:
        return web.json_response({"error": "Audio already running"}, status=400)

    # Re-discover tracks from disk so new/edited .rb files are picked up
    state.tracks = state._find_tracks()

    data = await request.json() if request.content_length else {}
    track_name = data.get("track", "midnight_ticker")

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
        track_path = state.tracks[track_name]["path"]
        await state.sonic.run_file(track_path)
        state.current_track = track_name
        state.audio_running = True
        await asyncio.sleep(2)

        # Apply current master volume (track's set_volume! may differ)
        await state.sonic.run_code(f"set_volume! {state.master_volume:.2f}")

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
        # Push test data values — track interprets them
        await state.sonic.run_code("""
set :heat, 0.6
set :price, 0.65
set :velocity, 0.3
set :trade_rate, 0.5
set :spread, 0.2
set :tone, 1
""")

    return web.json_response({"ok": True, "test": test_type})


async def handle_stop_audio(request):
    """Stop Sonic Pi and kill all orphan processes."""
    import subprocess as sp

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

    # Kill any orphaned scsynth/ruby processes
    for proc_name in ["scsynth.exe", "ruby.exe"]:
        try:
            sp.run(["taskkill", "/F", "/IM", proc_name],
                   capture_output=True, text=True)
        except Exception:
            pass

    state.audio_running = False
    state.sandbox_mode = False
    state.current_track = None
    return web.json_response({"ok": True})


async def handle_change_track(request):
    """Switch to a different track."""
    # Re-discover tracks from disk so new/edited .rb files are picked up
    state.tracks = state._find_tracks()

    data = await request.json()
    track_name = data.get("track")

    if track_name not in state.tracks:
        return web.json_response({"error": f"Unknown track: {track_name}"}, status=400)

    if state.sonic and state.audio_running:
        await state.sonic.stop_code()
        await asyncio.sleep(1)
        await state.sonic.run_file(state.tracks[track_name]["path"])
        state.current_track = track_name
        await asyncio.sleep(2)
        # Re-apply master volume after track load
        await state.sonic.run_code(f"set_volume! {state.master_volume:.2f}")
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


async def handle_volume(request):
    """Set master volume in Sonic Pi."""
    data = await request.json()
    vol = data.get("volume", 0.7)
    vol = max(0.0, min(1.0, float(vol)))
    state.master_volume = vol
    if state.sonic and state.audio_running:
        await state.sonic.run_code(f"set_volume! {vol:.2f}")
        return web.json_response({"ok": True, "volume": vol})
    return web.json_response({"error": "Audio not running"}, status=400)


async def handle_browse(request):
    """Browse markets by category."""
    import polymarket.gamma as gamma_module
    tag_id = request.query.get("tag_id")
    sort = request.query.get("sort", "volume")
    limit = int(request.query.get("limit", "10"))
    try:
        if tag_id == "live":
            markets = gamma_module.fetch_live_finance_markets()
        else:
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


# ── Track analyzer ───────────────────────────────────────

_DATA_PARAMS = {"heat", "price", "velocity", "trade_rate", "spread", "tone",
                "event_spike", "event_price_move", "market_resolved", "ambient_mode"}

def analyze_track(track_path: str) -> list[dict]:
    """Parse a .rb track file and extract live_loop names + which get() params each reads."""
    with open(track_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Ruby keywords that open a block closed by `end`
    _BLOCK_OPENERS = re.compile(
        r'\b(do|if|unless|while|until|for|begin|case|def|define|class|module)\b'
    )

    loops = []
    current_loop = None
    depth = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('#'):
            continue

        # Detect live_loop :name [, opts] do
        m = re.match(r'live_loop\s+:(\w+).*\bdo\b', stripped)
        if m:
            current_loop = {"name": m.group(1), "params": set()}
            depth = 1
            continue

        if current_loop:
            # Count block openers (do, if, def, etc.) — each needs a matching end
            # Inline if/unless (e.g. `x if cond`) don't open blocks — skip those
            # by only counting if the keyword is at statement start or after a newline
            openers = len(_BLOCK_OPENERS.findall(stripped))
            # Subtract inline conditionals: `expr if cond` where if is not at start
            if re.search(r'\S+\s+if\s+', stripped):
                openers = max(0, openers - stripped.count(' if '))
            if re.search(r'\S+\s+unless\s+', stripped):
                openers = max(0, openers - stripped.count(' unless '))

            closers = len(re.findall(r'\bend\b', stripped))
            depth += openers - closers

            if depth <= 0:
                loops.append({
                    "name": current_loop["name"],
                    "params": sorted(current_loop["params"]),
                    "connected": len(current_loop["params"]) > 0,
                })
                current_loop = None
                continue

            # Find get(:param) or get :param
            for gm in re.finditer(r'get\s*[\(:][:]*(\w+)', stripped):
                param = gm.group(1)
                if param in _DATA_PARAMS:
                    current_loop["params"].add(param)

    return loops


async def handle_track_analyze(request):
    """Return live_loop → parameter mappings for a track."""
    track_name = request.query.get("track")
    if not track_name or track_name not in state.tracks:
        return web.json_response({"error": "Unknown track", "available": list(state.tracks.keys())}, status=400)

    loops = analyze_track(state.tracks[track_name]["path"])
    return web.json_response({"ok": True, "track": track_name, "loops": loops})


# ── Sandbox API handlers ─────────────────────────────────

async def handle_sandbox_start(request):
    """Boot Sonic Pi and load a track in sandbox mode (no market data push)."""
    if state.audio_running and not state.sandbox_mode:
        return web.json_response({"error": "Audio already running in live mode. Stop it first."}, status=400)

    data = await request.json() if request.content_length else {}
    track_name = data.get("track", "midnight_ticker")

    if track_name not in state.tracks:
        return web.json_response({"error": f"Unknown track: {track_name}",
                                  "available": list(state.tracks.keys())}, status=400)

    try:
        if not state.sonic:
            state.sonic = SonicPiHeadless()
            await state.sonic.boot(timeout=30)

        # Stop any existing code
        if state.audio_running:
            await state.sonic.stop_code()
            await asyncio.sleep(0.5)

        # Cancel any data push loops (sandbox = manual control only)
        for t in [state._push_task, state._price_task]:
            if t:
                t.cancel()
        state._push_task = None
        state._price_task = None

        # Load track
        track_path = state.tracks[track_name]["path"]
        await state.sonic.run_file(track_path)
        state.current_track = track_name
        state.audio_running = True
        state.sandbox_mode = True

        return web.json_response({"ok": True, "track": track_name})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


async def handle_sandbox_stop(request):
    """Stop sandbox mode audio."""
    if not state.sandbox_mode:
        return web.json_response({"error": "Not in sandbox mode"}, status=400)

    if state.sonic:
        await state.sonic.stop_code()
        await state.sonic.shutdown()
        state.sonic = None

    state.audio_running = False
    state.sandbox_mode = False
    state.current_track = None
    return web.json_response({"ok": True})


async def handle_sandbox_push(request):
    """Push manual data values to Sonic Pi (sandbox mode)."""
    if not state.sonic or not state.audio_running:
        return web.json_response({"error": "Audio not running"}, status=400)

    data = await request.json()
    code = ""
    for key in ["heat", "price", "velocity", "trade_rate", "spread"]:
        if key in data:
            val = max(0.0, min(1.0, float(data[key])))
            code += f"set :{key}, {val:.4f}\n"
    for key in ["tone", "event_spike", "ambient_mode"]:
        if key in data:
            val = int(data[key])
            code += f"set :{key}, {val}\n"
    if "event_price_move" in data:
        val = int(data["event_price_move"])
        code += f"set :event_price_move, {val}\n"
    if "market_resolved" in data:
        val = int(data["market_resolved"])
        code += f"set :market_resolved, {val}\n"

    if code:
        try:
            await state.sonic.run_code(code)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"ok": True})


async def handle_sandbox_page(request):
    return web.Response(text=SANDBOX_PAGE, content_type="text/html")


async def handle_index(request):
    return web.Response(text=HTML_PAGE, content_type="text/html")


# ── HTML UI ───────────────────────────────────────────────

HTML_PAGE = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>The Polymarket DJ</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 14px; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }
  h1 { color: #00ff88; font-size: 24px; margin-bottom: 5px; }
  .subtitle { color: #666; margin-bottom: 20px; font-size: 12px; }

  .panel { background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .panel h2 { color: #00aaff; font-size: 15px; margin-bottom: 12px; }
  .panel-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .panel-header h2 { margin-bottom: 0; }

  .audio-grid {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0 16px;
    align-items: center;
  }
  .audio-status { display: flex; align-items: center; gap: 6px; }
  .audio-controls { display: flex; gap: 6px; }
  .audio-track { display: flex; flex-direction: column; gap: 4px; justify-self: end; }
  .audio-track select { min-width: 150px; }
  .audio-volume { display: flex; flex-direction: column; gap: 4px; }

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
  button:disabled { opacity: 0.3; cursor: default; }

  select {
    background: #1a1a2e; color: #e0e0e0; border: 1px solid #333;
    padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 13px;
  }

  /* Custom range slider */
  input[type="range"] {
    -webkit-appearance: none; appearance: none;
    background: transparent; cursor: pointer;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 4px; background: #1a1a2e; border: 1px solid #333; border-radius: 2px;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%;
    background: #00aaff; border: 1px solid #00aaff;
    margin-top: -6px; box-shadow: 0 0 6px #00aaff44;
  }
  input[type="range"]::-moz-range-track {
    height: 4px; background: #1a1a2e; border: 1px solid #333; border-radius: 2px;
  }
  input[type="range"]::-moz-range-thumb {
    width: 12px; height: 12px; border-radius: 50%;
    background: #00aaff; border: 1px solid #00aaff;
    box-shadow: 0 0 6px #00aaff44;
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
  .browse-play-btn {
    background: #00aaff22; color: #00aaff; border: 1px solid #00aaff44; border-radius: 4px;
    padding: 4px 14px; font-family: inherit; font-size: 11px; font-weight: bold; cursor: pointer;
    text-transform: uppercase; letter-spacing: 0.5px; transition: all 0.15s; white-space: nowrap;
  }
  .browse-play-btn:hover { background: #00aaff44; border-color: #00aaff; color: #fff; }
  .browse-play-btn.is-playing {
    background: #00ff8822; color: #00ff88; border-color: #00ff8844; cursor: default;
  }
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
  .browse-card { cursor: pointer; }
  .browse-card.playing { border-color: #00ff88; background: #081a0e; }

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


  #log {
    background: #08080c; border: 1px solid #1a1a2e; border-radius: 4px;
    padding: 10px; height: 100px; overflow-y: auto; font-size: 11px; color: #444; margin-top: 10px;
  }
</style>
</head>
<body>
<div class="container">
  <div style="display:flex; align-items:center; gap:16px;">
    <h1>THE POLYMARKET DJ</h1>
    <a href="/sandbox" style="color:#ff9900; text-decoration:none; font-size:12px; border:1px solid #ff990044; padding:4px 10px; border-radius:4px;">Track Sandbox</a>
  </div>
  <div class="subtitle">Listen to the market move.</div>

  <!-- Audio Engine -->
  <div class="panel">
    <div class="panel-header">
      <h2>Audio</h2>
      <div class="audio-status">
        <span class="dot" id="audio-dot"></span>
        <span id="audio-label">Stopped</span>
      </div>
    </div>
    <div class="audio-grid">
      <div class="audio-controls">
        <button onclick="startAudio()">Start</button>
        <button class="danger" onclick="stopAudio()">Stop</button>
      </div>
      <div class="audio-track">
        <label style="color:#555; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Track</label>
        <select id="track-select" onchange="onTrackChange()"></select>
      </div>
      <div class="audio-volume">
        <label style="color:#555; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Volume</label>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="range" id="volume-slider" min="0" max="100" value="70" style="width:100px;" oninput="onVolumeChange(this.value)">
          <span id="volume-label" style="color:#00aaff; font-size:12px; min-width:30px;">70%</span>
        </div>
      </div>
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
  </div>

  <!-- Data Source -->
  <div class="panel">
    <h2>Data Source</h2>
    <div class="url-row">
      <input type="text" id="url-input" placeholder="Paste Polymarket URL to play..." onkeydown="if(event.key==='Enter')playUrl()">
      <button onclick="playUrl()">Play URL</button>
    </div>
    <div class="url-status" id="url-status"></div>

    <div style="margin-top:6px;">
      <div id="browse-tabs" class="browse-tabs"></div>
      <div id="browse-results" style="margin-top:8px;"></div>
    </div>
  </div>

  <div id="log"></div>
</div>

<script>
let lastStatus = null;
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
  if (lastStatus && lastStatus.audio_running) {
    log('Restarting: ' + track);
    await api('/api/stop', 'POST');
  } else {
    log('Starting: ' + track);
  }
  const r = await api('/api/start', 'POST', {track});
  r.ok ? log('Audio on, port ' + r.osc_port) : log('ERR: ' + r.error);
}
async function stopAudio() {
  const r = await api('/api/stop', 'POST');
  r.ok ? log('Audio stopped') : log('ERR: ' + r.error);
  // Re-render browse to reset Play/Playing buttons
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
}
async function onTrackChange() {
  if (!lastStatus || !lastStatus.audio_running) return;
  const track = document.getElementById('track-select').value;
  if (track === lastStatus.current_track) return;
  log('Switching to: ' + track);
  const r = await api('/api/track', 'POST', {track});
  r.ok ? log('Track: ' + r.track) : log('ERR: ' + r.error);
}
async function testSound(type) {
  log('Test: ' + type);
  const r = await api('/api/test-sound', 'POST', {type});
  r.ok ? log('Test sound: ' + type) : log('ERR: ' + r.error);
}

// ── Volume ──
let volumeTimer = null;
function onVolumeChange(rawVal) {
  const pct = parseInt(rawVal);
  document.getElementById('volume-label').textContent = pct + '%';
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(async () => {
    await api('/api/volume', 'POST', {volume: pct / 100});
  }, 200);
}

// ── URL play ──
async function playUrl() {
  const input = document.getElementById('url-input');
  const status = document.getElementById('url-status');
  const url = input.value.trim();
  if (!url) return;
  status.textContent = 'Loading...';
  status.style.color = '#00aaff';
  // Auto-start audio if not running
  if (!lastStatus || !lastStatus.audio_running) {
    const track = document.getElementById('track-select').value;
    log('Starting: ' + track);
    const sr = await api('/api/start', 'POST', {track});
    if (!sr.ok) { status.textContent = 'Error: ' + sr.error; status.style.color = '#ff4444'; return; }
    log('Audio on, port ' + sr.osc_port);
  }
  try {
    const r = await api('/api/play-url', 'POST', {url});
    if (r.ok) {
      status.textContent = '';
      input.value = '';
      log('Playing: ' + r.question);
    } else {
      status.textContent = 'Error: ' + r.error;
      status.style.color = '#ff4444';
    }
  } catch(e) {
    status.textContent = 'Failed to load URL';
    status.style.color = '#ff4444';
  }
}

// ── Play from browse ──
async function playBrowseMarket(slug, question, eventSlug) {
  // Auto-start audio if not running
  if (!lastStatus || !lastStatus.audio_running) {
    const track = document.getElementById('track-select').value;
    log('Starting: ' + track);
    const sr = await api('/api/start', 'POST', {track});
    if (!sr.ok) { log('ERR: ' + sr.error); return; }
    log('Audio on, port ' + sr.osc_port);
  }
  const r = await api('/api/play-url', 'POST', {url: 'https://polymarket.com/event/' + (eventSlug || slug)});
  if (r.ok) {
    log('Playing: ' + r.question);
    if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
  } else {
    log('ERR: ' + r.error);
  }
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

  if (browseCache[cacheKey] && tagId !== 'live') {
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
  const playing = lastStatus && lastStatus.audio_running && lastStatus.pinned;
  el.innerHTML = markets.map(m => {
    const slug = (m.slug||'').replace(/'/g, "\\'");
    const q = (m.question||'').replace(/'/g, "\\'");
    const es = (m.event_slug||m.slug||'').replace(/'/g, "\\'");
    const link = es ? 'https://polymarket.com/event/' + es : '';
    const pricePct = m.price !== null ? (m.price * 100).toFixed(0) + '%' : '';
    const vol = m.volume > 0 ? '$' + (m.volume/1000).toFixed(0) + 'k' : '';
    const isPlaying = playing === m.slug;
    const cls = isPlaying ? 'browse-card playing' : 'browse-card';
    const playBtn = isPlaying
      ? '<button class="browse-play-btn is-playing" disabled>Playing</button>'
      : '<button class="browse-play-btn" onclick="playBrowseMarket(\'' + slug + '\',\'' + q + '\',\'' + es + '\')">Play</button>';
    return '<div class="' + cls + '">'
      + '<div class="browse-body">'
      + '<div class="browse-question">' + (m.question||'').substring(0,65) + '</div>'
      + '<div class="browse-meta">' + vol + '</div>'
      + '</div>'
      + (pricePct ? '<div class="browse-price">' + pricePct + '</div>' : '')
      + (link ? '<a class="market-link" href="' + link + '" target="_blank" rel="noopener">View &#x2197;</a>' : '')
      + playBtn
      + '</div>';
  }).join('');
}

// ── Status polling ──
function updateUI(s) {
  const ad = document.getElementById('audio-dot');
  ad.className = 'dot ' + (s.audio_running ? 'dot-on' : 'dot-off');
  document.getElementById('audio-label').textContent = s.audio_running ? 'Playing: ' + s.current_track : 'Stopped';

  const sel = document.getElementById('track-select');
  if (sel.options.length === 0 && s.tracks) {
    const groups = {};
    s.tracks.forEach(t => {
      const cat = t.category || 'music';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    const order = [['music', 'Music'], ['alert', 'Alerts']];
    order.forEach(([key, label]) => {
      if (!groups[key]) return;
      const og = document.createElement('optgroup');
      og.label = label;
      groups[key].forEach(t => og.add(new Option(t.label, t.name)));
      sel.add(og);
    });
  }
  if (s.current_track && sel.value !== s.current_track) {
    sel.value = s.current_track;
  }

  document.getElementById('feed-dot').className = 'dot ' + (s.feed_running ? 'dot-on' : 'dot-off');
  document.getElementById('feed-label').textContent = s.feed_running ? 'Feed: connected' : 'Feed: disconnected';
  document.getElementById('event-count').textContent = s.event_rate ? s.event_rate + ' events' : '';

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
    if (s.current_market.data) {
      const d = s.current_market.data;
      document.getElementById('np-osc').innerHTML = [
        ['HEAT', d.heat], ['PRICE', d.price], ['VELOCITY', d.velocity],
        ['TRADE RATE', d.trade_rate], ['SPREAD', d.spread], ['TONE', d.tone ? 'MAJ' : 'MIN']
      ].map(([l,v]) => '<div class="osc-cell"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>').join('');
    }
  } else { np.style.display = 'none'; }

  // Re-render browse to update playing state
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
}

setInterval(async () => {
  try { const s = await api('/api/status'); updateUI(s); lastStatus = s; } catch(e) {}
}, 1500);

initBrowse();
log('Ready. Pick a market to play, or paste a Polymarket URL.');
</script>
</body>
</html>
"""


# ── Sandbox HTML ──────────────────────────────────────────

SANDBOX_PAGE = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Track Sandbox — The Polymarket DJ</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0f; color: #e0e0e0; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 14px; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px; }

  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  h1 { color: #ff9900; font-size: 22px; }
  .back-link { color: #00aaff; text-decoration: none; font-size: 12px; border: 1px solid #00aaff44; padding: 4px 10px; border-radius: 4px; }
  .back-link:hover { background: #00aaff22; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }

  .panel { background: #12121a; border: 1px solid #222; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .panel h2 { color: #00aaff; font-size: 15px; margin-bottom: 12px; }
  .panel-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .panel-header h2 { margin-bottom: 0; }
  .panel h3 { color: #ff9900; font-size: 13px; margin: 14px 0 8px 0; }

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
  button.orange { border-color: #ff9900; color: #ff9900; }
  button.orange:hover { background: #ff9900; color: #0a0a0f; }
  button.orange.active { background: #ff9900; color: #0a0a0f; font-weight: bold; }
  button:disabled { opacity: 0.3; cursor: default; }
  button.sm { padding: 4px 10px; font-size: 11px; }

  select {
    background: #1a1a2e; color: #e0e0e0; border: 1px solid #333;
    padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 13px;
  }

  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 6px; }
  .dot-on { background: #ff9900; box-shadow: 0 0 8px #ff9900; }
  .dot-off { background: #333; }

  /* Slider styles */
  .slider-group { margin-bottom: 12px; }
  .slider-label { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .slider-name { color: #888; font-size: 12px; text-transform: uppercase; }
  .slider-value { color: #ff9900; font-size: 14px; font-weight: bold; min-width: 50px; text-align: right; }
  input[type="range"] {
    -webkit-appearance: none; width: 100%; height: 6px; background: #1a1a2e;
    border-radius: 3px; outline: none; border: 1px solid #333;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 18px; height: 18px; background: #ff9900;
    border-radius: 50%; cursor: pointer; border: 2px solid #0a0a0f;
  }
  input[type="range"]::-moz-range-thumb {
    width: 18px; height: 18px; background: #ff9900;
    border-radius: 50%; cursor: pointer; border: 2px solid #0a0a0f;
  }

  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 800px) { .columns { grid-template-columns: 1fr; } }

  /* Instrument map */
  .loop-card {
    background: #0d0d15; border: 1px solid #1a1a2e; border-radius: 6px;
    padding: 10px 14px; margin-bottom: 6px; transition: all 0.15s;
  }
  .loop-card.connected { border-color: #ff990044; }
  .loop-card.disconnected { border-color: #33333344; opacity: 0.6; }
  .loop-name { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
  .loop-name.connected { color: #ff9900; }
  .loop-name.disconnected { color: #555; }
  .loop-params { display: flex; flex-wrap: wrap; gap: 4px; }
  .param-tag {
    font-size: 10px; padding: 2px 6px; border-radius: 3px;
    background: #1a1a2e; border: 1px solid #333; color: #888;
  }
  .param-tag.active { border-color: #ff9900; color: #ff9900; background: #ff990015; }
  .no-params { font-size: 11px; color: #444; font-style: italic; }

  /* Toggle buttons for tone/events */
  .toggle-row { display: flex; gap: 6px; align-items: center; }
  .toggle-btn {
    background: #1a1a2e; color: #666; border: 1px solid #333;
    padding: 5px 12px; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 12px; transition: all 0.15s;
  }
  .toggle-btn:hover { border-color: #ff9900; color: #ccc; }
  .toggle-btn.active { background: #ff990022; border-color: #ff9900; color: #ff9900; font-weight: bold; }

  /* Preset buttons */
  .preset-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
  .preset-btn {
    background: #1a1a2e; color: #00aaff; border: 1px solid #00aaff44;
    padding: 5px 12px; border-radius: 4px; cursor: pointer;
    font-family: inherit; font-size: 11px; transition: all 0.15s;
  }
  .preset-btn:hover { background: #00aaff22; border-color: #00aaff; }

  #log {
    background: #08080c; border: 1px solid #1a1a2e; border-radius: 4px;
    padding: 10px; height: 80px; overflow-y: auto; font-size: 11px; color: #444; margin-top: 10px;
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>TRACK SANDBOX</h1>
    <a class="back-link" href="/">Back to DJ</a>
  </div>
  <div class="subtitle">Load a track, move the sliders, hear how data shapes the music. No market connection needed.</div>

  <!-- Audio Engine -->
  <div class="panel">
    <h2>Audio</h2>
    <div class="row">
      <span class="dot" id="audio-dot"></span>
      <span id="audio-label">Stopped</span>
      <select id="track-select"></select>
      <button class="orange" onclick="sandboxStart()">Start</button>
      <button class="danger" onclick="sandboxStop()">Stop</button>
      <button class="orange" onclick="switchTrack()">Switch Track</button>
      <button class="danger" onclick="killAll()" style="margin-left:auto;">Kill All</button>
    </div>
  </div>

  <div class="columns">
    <!-- Left: Sliders -->
    <div>
      <div class="panel">
        <h2>Data Controls</h2>

        <h3>Presets</h3>
        <div class="preset-row">
          <button class="preset-btn" onclick="applyPreset('calm')">Calm</button>
          <button class="preset-btn" onclick="applyPreset('moderate')">Moderate</button>
          <button class="preset-btn" onclick="applyPreset('intense')">Intense</button>
          <button class="preset-btn" onclick="applyPreset('zero')">All Zero</button>
          <button class="preset-btn" onclick="applyPreset('max')">All Max</button>
        </div>

        <h3>Continuous (0.0 — 1.0)</h3>
        <div class="slider-group">
          <div class="slider-label"><span class="slider-name">Heat</span><span class="slider-value" id="val-heat">0.40</span></div>
          <input type="range" id="sl-heat" min="0" max="100" value="40" oninput="onSlider('heat',this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label"><span class="slider-name">Price</span><span class="slider-value" id="val-price">0.50</span></div>
          <input type="range" id="sl-price" min="0" max="100" value="50" oninput="onSlider('price',this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label"><span class="slider-name">Velocity</span><span class="slider-value" id="val-velocity">0.20</span></div>
          <input type="range" id="sl-velocity" min="0" max="100" value="20" oninput="onSlider('velocity',this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label"><span class="slider-name">Trade Rate</span><span class="slider-value" id="val-trade_rate">0.30</span></div>
          <input type="range" id="sl-trade_rate" min="0" max="100" value="30" oninput="onSlider('trade_rate',this.value)">
        </div>
        <div class="slider-group">
          <div class="slider-label"><span class="slider-name">Spread</span><span class="slider-value" id="val-spread">0.20</span></div>
          <input type="range" id="sl-spread" min="0" max="100" value="20" oninput="onSlider('spread',this.value)">
        </div>

        <h3>Tone</h3>
        <div class="toggle-row">
          <button class="toggle-btn active" id="tone-1" onclick="setTone(1)">Major (Bullish)</button>
          <button class="toggle-btn" id="tone-0" onclick="setTone(0)">Minor (Bearish)</button>
        </div>

        <h3>Event Triggers (one-shot)</h3>
        <div class="row">
          <button class="orange sm" onclick="fireEvent('event_spike')">Heat Spike</button>
          <button class="sm" onclick="fireEvent('event_price_move', 1)">Price Up</button>
          <button class="sm" onclick="fireEvent('event_price_move', -1)">Price Down</button>
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="sm" onclick="fireEvent('market_resolved', 1)">Resolved: Yes Won</button>
          <button class="sm" onclick="fireEvent('market_resolved', -1)">Resolved: No Won</button>
          <button class="sm" onclick="fireEvent('market_resolved', 0)">Clear Resolved</button>
        </div>

        <h3>Ambient Mode</h3>
        <div class="toggle-row">
          <button class="toggle-btn" id="ambient-0" onclick="setAmbient(0)">Off</button>
          <button class="toggle-btn" id="ambient-1" onclick="setAmbient(1)">On (no market)</button>
        </div>
      </div>
    </div>

    <!-- Right: Instrument Map -->
    <div>
      <div class="panel">
        <h2>Instrument Map</h2>
        <div id="instrument-map">
          <div style="color:#444; font-size:12px;">Start a track to see its instruments and data connections.</div>
        </div>
      </div>
    </div>
  </div>

  <div id="log"></div>
</div>

<script>
let audioRunning = false;
let currentTrack = null;
let pushTimer = null;
let pendingPush = {};
let trackLoops = [];

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

// ── Track list ──
async function loadTracks() {
  const r = await api('/api/status');
  const sel = document.getElementById('track-select');
  if (r.tracks) {
    sel.innerHTML = '';
    const groups = {};
    r.tracks.forEach(t => {
      const cat = t.category || 'music';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    const order = [['music', 'Music'], ['alert', 'Alerts']];
    order.forEach(([key, label]) => {
      if (!groups[key]) return;
      const og = document.createElement('optgroup');
      og.label = label;
      groups[key].forEach(t => og.add(new Option(t.label, t.name)));
      sel.add(og);
    });
  }
}

// ── Audio control ──
async function sandboxStart() {
  const track = document.getElementById('track-select').value;
  log('Starting sandbox: ' + track);
  const r = await api('/api/sandbox/start', 'POST', {track});
  if (r.ok) {
    audioRunning = true;
    currentTrack = track;
    updateAudioUI();
    loadInstrumentMap(track);
    log('Sandbox active: ' + track);
    // Push current slider state
    pushAllSliders();
  } else {
    log('ERR: ' + r.error);
  }
}

async function sandboxStop() {
  const r = await api('/api/sandbox/stop', 'POST');
  if (r.ok) {
    audioRunning = false;
    currentTrack = null;
    updateAudioUI();
    log('Sandbox stopped');
  } else {
    log('ERR: ' + r.error);
  }
}

async function switchTrack() {
  if (!audioRunning) { log('Start audio first'); return; }
  const track = document.getElementById('track-select').value;
  log('Switching to: ' + track);
  const r = await api('/api/sandbox/start', 'POST', {track});
  if (r.ok) {
    currentTrack = track;
    updateAudioUI();
    loadInstrumentMap(track);
    log('Now playing: ' + track);
    pushAllSliders();
  } else {
    log('ERR: ' + r.error);
  }
}

async function killAll() {
  const r = await api('/api/kill-all', 'POST');
  audioRunning = false;
  currentTrack = null;
  updateAudioUI();
  r.ok ? log(r.message) : log('ERR: ' + r.error);
}

function updateAudioUI() {
  const dot = document.getElementById('audio-dot');
  dot.className = 'dot ' + (audioRunning ? 'dot-on' : 'dot-off');
  document.getElementById('audio-label').textContent = audioRunning ? 'Sandbox: ' + currentTrack : 'Stopped';
}

// ── Slider handling ──
function onSlider(param, rawVal) {
  const val = (rawVal / 100).toFixed(2);
  document.getElementById('val-' + param).textContent = val;
  schedulePush(param, parseFloat(val));
  highlightActiveParams();
}

function schedulePush(key, val) {
  pendingPush[key] = val;
  if (!pushTimer) {
    pushTimer = setTimeout(flushPush, 100);
  }
}

async function flushPush() {
  pushTimer = null;
  if (!audioRunning) return;
  const data = {...pendingPush};
  pendingPush = {};
  await api('/api/sandbox/push', 'POST', data);
}

function pushAllSliders() {
  const params = ['heat', 'price', 'velocity', 'trade_rate', 'spread'];
  const data = {};
  params.forEach(p => {
    data[p] = parseInt(document.getElementById('sl-' + p).value) / 100;
  });
  // Include tone
  data.tone = document.getElementById('tone-1').classList.contains('active') ? 1 : 0;
  data.ambient_mode = document.getElementById('ambient-1').classList.contains('active') ? 1 : 0;
  if (audioRunning) {
    api('/api/sandbox/push', 'POST', data);
  }
}

// ── Tone toggle ──
function setTone(val) {
  document.getElementById('tone-0').classList.toggle('active', val === 0);
  document.getElementById('tone-1').classList.toggle('active', val === 1);
  schedulePush('tone', val);
}

// ── Ambient toggle ──
function setAmbient(val) {
  document.getElementById('ambient-0').classList.toggle('active', val === 0);
  document.getElementById('ambient-1').classList.toggle('active', val === 1);
  schedulePush('ambient_mode', val);
}

// ── Event triggers ──
async function fireEvent(key, val) {
  if (!audioRunning) { log('Start audio first'); return; }
  const data = {};
  if (key === 'event_spike') {
    data.event_spike = 1;
    log('Fired: heat spike');
  } else {
    data[key] = val;
    log('Fired: ' + key + ' = ' + val);
  }
  await api('/api/sandbox/push', 'POST', data);
  // Auto-reset one-shot events after a moment
  if (key === 'event_spike' || key === 'event_price_move') {
    setTimeout(async () => {
      const reset = {};
      reset[key] = 0;
      await api('/api/sandbox/push', 'POST', reset);
    }, 500);
  }
}

// ── Presets ──
const PRESETS = {
  calm:     { heat: 15, price: 50, velocity: 5,  trade_rate: 10, spread: 10 },
  moderate: { heat: 45, price: 55, velocity: 25, trade_rate: 40, spread: 20 },
  intense:  { heat: 85, price: 70, velocity: 60, trade_rate: 80, spread: 40 },
  zero:     { heat: 0,  price: 0,  velocity: 0,  trade_rate: 0,  spread: 0  },
  max:      { heat: 100, price: 100, velocity: 100, trade_rate: 100, spread: 100 },
};

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.entries(p).forEach(([key, val]) => {
    document.getElementById('sl-' + key).value = val;
    document.getElementById('val-' + key).textContent = (val / 100).toFixed(2);
    pendingPush[key] = val / 100;
  });
  if (!pushTimer) pushTimer = setTimeout(flushPush, 100);
  highlightActiveParams();
  log('Preset: ' + name);
}

// ── Instrument Map ──
async function loadInstrumentMap(track) {
  const el = document.getElementById('instrument-map');
  el.innerHTML = '<div style="color:#444; font-size:12px;">Analyzing track...</div>';

  const r = await api('/api/track/analyze?track=' + encodeURIComponent(track));
  if (!r.ok) {
    el.innerHTML = '<div style="color:#ff4444; font-size:12px;">Failed to analyze track</div>';
    return;
  }

  trackLoops = r.loops;
  renderInstrumentMap();
}

function renderInstrumentMap() {
  const el = document.getElementById('instrument-map');
  if (!trackLoops.length) {
    el.innerHTML = '<div style="color:#444; font-size:12px;">No live_loops found in track.</div>';
    return;
  }

  const allParams = ['heat', 'price', 'velocity', 'trade_rate', 'spread', 'tone',
                     'event_spike', 'event_price_move', 'market_resolved', 'ambient_mode'];

  // Get current slider values to highlight which params are "active" (non-zero)
  const activeParams = getActiveParams();

  el.innerHTML = trackLoops.map(loop => {
    const cls = loop.connected ? 'connected' : 'disconnected';
    const nameCls = loop.connected ? 'connected' : 'disconnected';
    const paramTags = loop.params.length > 0
      ? loop.params.map(p => {
          const isActive = activeParams.has(p);
          return '<span class="param-tag' + (isActive ? ' active' : '') + '">' + p + '</span>';
        }).join('')
      : '<span class="no-params">no data connection</span>';

    return '<div class="loop-card ' + cls + '">'
      + '<div class="loop-name ' + nameCls + '">' + loop.name + '</div>'
      + '<div class="loop-params">' + paramTags + '</div>'
      + '</div>';
  }).join('');
}

function getActiveParams() {
  const active = new Set();
  const sliders = ['heat', 'price', 'velocity', 'trade_rate', 'spread'];
  sliders.forEach(p => {
    const v = parseInt(document.getElementById('sl-' + p).value);
    if (v > 5) active.add(p);
  });
  if (document.getElementById('tone-1').classList.contains('active')) active.add('tone');
  if (document.getElementById('tone-0').classList.contains('active')) active.add('tone');
  active.add('tone'); // tone is always relevant
  return active;
}

function highlightActiveParams() {
  if (trackLoops.length) renderInstrumentMap();
}

// ── Init ──
loadTracks();
updateAudioUI();
log('Track Sandbox ready. Pick a track and click Start.');
</script>
</body>
</html>
"""


# ── App setup ─────────────────────────────────────────────

async def _on_market_ended():
    """Stop audio when a non-live-finance market resolves."""
    print("[SERVER] Market ended (resolved) — stopping audio", flush=True)
    if state.sonic and state.audio_running:
        await state.sonic.stop_code()
        state.audio_running = False
        state.current_track = None
        # Cancel data push loops — no market to push
        for t in [state._push_task, state._price_task]:
            if t:
                t.cancel()
        state._push_task = None
        state._price_task = None


async def on_startup(app):
    """Start Polymarket feed and DJ on server boot."""
    import polymarket.gamma as gamma_module

    state.osc = OSCBridge(state.scorer)
    state.dj = AutonomousDJ(state.scorer, None, state.osc, gamma_module)
    state.dj.on_market_ended = _on_market_ended
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
    app.router.add_post("/api/kill-all", handle_kill_all)
    app.router.add_post("/api/volume", handle_volume)
    app.router.add_get("/api/browse", handle_browse)
    app.router.add_get("/api/categories", handle_categories)
    app.router.add_get("/api/track/analyze", handle_track_analyze)
    app.router.add_get("/sandbox", handle_sandbox_page)
    app.router.add_post("/api/sandbox/start", handle_sandbox_start)
    app.router.add_post("/api/sandbox/stop", handle_sandbox_stop)
    app.router.add_post("/api/sandbox/push", handle_sandbox_push)

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
