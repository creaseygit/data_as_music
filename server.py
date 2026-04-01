"""
The Polymarket DJ — Web Server

Data-only server: connects to Polymarket, scores markets, and pushes
normalized data to browser clients via WebSocket. Audio runs entirely
in the browser via Strudel.

    python server.py
    # Open http://localhost:8888
"""
import asyncio
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.stdout.reconfigure(line_buffering=True)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from aiohttp import web

from polymarket.scorer import MarketScorer
from polymarket.websocket import PolymarketFeed
from mixer.mixer import AutonomousDJ
from sessions import ClientSession, SessionManager
from config import (
    RESCORE_INTERVAL, BROWSE_CATEGORIES,
    DEFAULT_SENSITIVITY, EVENT_HEAT_THRESHOLD, EVENT_PRICE_THRESHOLD,
    WS_PING_INTERVAL, MAX_CLIENTS, DATA_PUSH_INTERVAL,
    PRICE_MOVE_WINDOW, PRICE_MOVE_MAX,
)


# ── Global state ──────────────────────────────────────────

class AppState:
    def __init__(self):
        self.scorer = MarketScorer()
        self.dj: AutonomousDJ | None = None
        self.feed: PolymarketFeed | None = None
        self.sessions = SessionManager()

        # Track metadata (read from frontend/tracks/)
        self.tracks = self._find_tracks()

        # Background tasks
        self._feed_task = None
        self._dj_task = None
        self._push_task = None
        self._price_task = None

    @staticmethod
    def _parse_track_meta(filepath):
        """Parse metadata from track JS files. Looks for exports like:
        export const meta = { name: '...', label: '...', category: '...' }
        Falls back to filename-based defaults."""
        meta = {"category": "music", "label": None}
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read(2000)  # only need the top
            # Look for category and label in comments or meta object
            if m := re.search(r'category:\s*["\'](\w+)["\']', content):
                meta["category"] = m.group(1)
            if m := re.search(r'label:\s*["\']([^"\']+)["\']', content):
                meta["label"] = m.group(1)
        except Exception:
            pass
        return meta

    def _find_tracks(self):
        """Find all .js track files in frontend/tracks/."""
        tracks = {}
        tracks_dir = Path("frontend/tracks")
        if not tracks_dir.exists():
            return tracks
        for f in sorted(tracks_dir.glob("*.js")):
            if f.stem.startswith("_") or f.stem == "track-interface":
                continue
            meta = self._parse_track_meta(str(f))
            tracks[f.stem] = {
                "path": str(f),
                "category": meta["category"],
                "label": meta["label"] or f.stem.replace("_", " ").title(),
            }
        return tracks


state = AppState()


# ── Utility functions ─────────────────────────────────────

def _scale(val, in_lo, in_hi, out_lo, out_hi):
    n = max(0.0, min(1.0, (val - in_lo) / max(in_hi - in_lo, 0.0001)))
    return out_lo + n * (out_hi - out_lo)


def _sensitivity_exponent(s: float) -> float:
    """Map sensitivity slider 0-1 to power curve exponent.
    s=0.0 → 4.0 (crushes small values), s=0.5 → 1.0 (linear), s=1.0 → 0.25 (inflates)."""
    return 4.0 ** (1.0 - 2.0 * s)


def _apply_sensitivity(value: float, exponent: float) -> float:
    """Apply power curve: value^exponent, clamped 0-1."""
    if value <= 0.0:
        return 0.0
    return max(0.0, min(1.0, value ** exponent))


def _sensitivity_window(sensitivity: float) -> int:
    """Map sensitivity 0–1 to window length in buffer entries (at 3s intervals).

    sensitivity=1.0 → 15 entries  (45s)  — scalper: catches quick pumps
    sensitivity=0.5 → ~49 entries (~2.5min) — day trader
    sensitivity=0.0 → 160 entries (8min) — swing trader: only sustained trends

    Exponential curve mirrors how short MA period differences matter more
    than long ones (9-EMA vs 20-EMA is a bigger deal than 180 vs 200).
    """
    return max(4, int(160 * (15 / 160) ** sensitivity))


def _get_api_price(market: dict, asset_id: str) -> float | None:
    """Get the API-reported price for an asset_id."""
    asset_ids = market.get("asset_ids", [])
    outcome_prices = market.get("outcome_prices", [])
    if asset_id in asset_ids and len(outcome_prices) == len(asset_ids):
        idx = asset_ids.index(asset_id)
        return outcome_prices[idx]
    return None


# ── Background loops ──────────────────────────────────────

async def feed_loop():
    """Run the Polymarket WebSocket feed."""
    print("[FEED] Starting Polymarket feed...", flush=True)
    try:
        await state.feed.connect()
    except asyncio.CancelledError:
        pass
    finally:
        print("[FEED] Feed stopped", flush=True)


async def dj_loop():
    """Run the DJ market refresh loop."""
    try:
        await state.dj.run()
    except asyncio.CancelledError:
        pass


async def price_poll_loop(interval=5.0):
    """Poll Gamma API for current market prices every 5s.
    Updates outcome_prices for all markets that clients are watching."""
    import polymarket.gamma as gamma_module
    print("[PRICE POLL] Loop started", flush=True)
    try:
        while True:
            await asyncio.sleep(interval)
            if not state.dj:
                continue
            # Collect unique slugs being watched by any client
            watched_slugs = set()
            for session in state.sessions.all_sessions():
                if session.market and session.market.get("slug"):
                    watched_slugs.add(session.market["slug"])
            for slug in watched_slugs:
                try:
                    fresh = await asyncio.to_thread(gamma_module.fetch_market_by_slug, slug)
                    if fresh and fresh.get("outcome_prices"):
                        # Update in DJ's market list
                        for m in state.dj.all_markets:
                            if m["slug"] == slug:
                                m["outcome_prices"] = fresh["outcome_prices"]
                                m["outcomes"] = fresh.get("outcomes", [])
                                break
                        # Update in each client's market ref
                        for session in state.sessions.all_sessions():
                            if session.market and session.market.get("slug") == slug:
                                session.market["outcome_prices"] = fresh["outcome_prices"]
                                session.market["outcomes"] = fresh.get("outcomes", [])
                except Exception as e:
                    print(f"[PRICE POLL] {slug}: error: {e}", flush=True)
    except asyncio.CancelledError:
        pass


def _compute_market_data(session: ClientSession, scorer: MarketScorer):
    """Compute normalized market data for a single client session.
    Returns (data_dict, events_list) or (None, []) if no market."""
    aid = session.asset_id
    market = session.market
    if not aid or not market:
        return None, []

    heat = scorer.heat(aid)
    vel = scorer.price_velocity(aid)
    rate = scorer.trade_rate(aid)
    bid, ask = scorer.spreads.get(aid, (0.4, 0.6))
    spread = ask - bid

    # Price: prefer WebSocket bid/ask midpoint, fall back to API
    api_price = _get_api_price(market, aid)
    ws_mid = None
    if bid != 0.4 or ask != 0.6:
        ws_mid = (bid + ask) / 2.0
    last_price = ws_mid if ws_mid is not None else (api_price if api_price is not None else 0.5)

    # Normalize to 0-1
    heat_n = max(0.0, min(1.0, heat))
    price_n = max(0.0, min(1.0, last_price))
    velocity_n = max(0.0, min(1.0, vel))
    trade_rate_n = max(0.0, min(1.0, rate))
    spread_n = _scale(spread, 0, 0.3, 0.0, 1.0)

    # Sensitivity curve
    sens_exp = _sensitivity_exponent(session.sensitivity)
    heat_n = _apply_sensitivity(heat_n, sens_exp)
    velocity_n = _apply_sensitivity(velocity_n, sens_exp)
    trade_rate_n = _apply_sensitivity(trade_rate_n, sens_exp)
    spread_n = _apply_sensitivity(spread_n, sens_exp)

    # Tone hysteresis
    if session._current_tone == 1 and last_price < 0.45:
        session._current_tone = 0
    elif session._current_tone == 0 and last_price > 0.55:
        session._current_tone = 1
    tone = session._current_tone

    # Rotation detection
    events = []
    is_rotation = (aid != session._prev_asset)
    if is_rotation:
        session._prev_asset = aid
        session._prev_heat = heat
        session._prev_price = last_price
        session._current_tone = 1 if last_price > 0.5 else 0
        session._price_history.clear()
        session._ema_fast = last_price
        session._ema_slow = last_price

    # Append to rolling price buffer (one entry per broadcast cycle)
    session._price_history.append(last_price)

    # ── Sensitivity-scaled window (for momentum & volatility) ──
    sens_window = _sensitivity_window(session.sensitivity)

    # ── Momentum: dual-EMA signed trend (MACD-inspired) ──
    # Fast EMA period = window/3, slow EMA period = window.
    # Sensitivity controls window → high sens = short EMAs = reactive.
    alpha_fast = 2.0 / (sens_window / 3 + 1)
    alpha_slow = 2.0 / (sens_window + 1)
    session._ema_fast += alpha_fast * (last_price - session._ema_fast)
    session._ema_slow += alpha_slow * (last_price - session._ema_slow)
    raw_momentum = session._ema_fast - session._ema_slow
    # Normalize: ±0.05 divergence → ±1.0
    momentum_n = max(-1.0, min(1.0, raw_momentum / 0.05))

    # ── Volatility: stddev of price over sensitivity-scaled window ──
    vol_entries = list(session._price_history)[-sens_window:]
    if len(vol_entries) >= 2:
        mean_p = sum(vol_entries) / len(vol_entries)
        variance = sum((p - mean_p) ** 2 for p in vol_entries) / len(vol_entries)
        stddev = variance ** 0.5
        # Normalize: 0.03 stddev (3¢ oscillation) → 1.0
        volatility_n = min(1.0, stddev / 0.03)
    else:
        volatility_n = 0.0

    # ── Event detection (with magnitudes) ──
    if not is_rotation:
        heat_delta = abs(heat - session._prev_heat)
        raw_price_delta = last_price - session._prev_price
        abs_price_delta = abs(raw_price_delta)
        if heat_delta > EVENT_HEAT_THRESHOLD * sens_exp:
            spike_mag = min(1.0, heat_delta / (EVENT_HEAT_THRESHOLD * 3))
            events.append({"event": "spike", "magnitude": round(spike_mag, 4)})
        if abs_price_delta > EVENT_PRICE_THRESHOLD * sens_exp:
            direction = 1 if raw_price_delta > 0 else -1
            move_mag = min(1.0, abs_price_delta / (EVENT_PRICE_THRESHOLD * 3))
            events.append({"event": "price_move", "direction": direction, "magnitude": round(move_mag, 4)})
    session._prev_heat = heat
    session._prev_price = last_price

    # ── Rolling price move (edge-detected, fixed 30s window) ──
    # Compute on RAW magnitude so edge detection thresholds stay consistent
    # regardless of sensitivity. Sensitivity is applied after edge detection.
    price_move_raw = 0.0
    if not is_rotation and len(session._price_history) >= 2:
        window_entries = min(
            len(session._price_history),
            max(1, int(PRICE_MOVE_WINDOW / DATA_PUSH_INTERVAL)),
        )
        old_price = session._price_history[-window_entries]
        raw_move = last_price - old_price
        move_sign = 1.0 if raw_move >= 0 else -1.0
        move_mag = min(1.0, abs(raw_move) / PRICE_MOVE_MAX)
        price_move_raw = move_sign * move_mag

    # Edge detection: only emit price_move when movement is *increasing*
    # (actively moving). When magnitude is flat or decaying (stale window
    # sliding past a completed move), emit zero.
    prev_pm = session._prev_price_move
    same_dir = (price_move_raw >= 0) == (prev_pm >= 0)
    if same_dir and abs(price_move_raw) > abs(prev_pm) + 0.01:
        price_move_n = price_move_raw          # magnitude growing → active move
    elif not same_dir and abs(price_move_raw) > 0.05:
        price_move_n = price_move_raw          # direction flipped → new move
    else:
        price_move_n = 0.0                     # flat or decaying → silence
    session._prev_price_move = price_move_raw

    # Apply sensitivity to the edge-detected result (not the raw input)
    if price_move_n != 0.0:
        pm_sign = 1.0 if price_move_n >= 0 else -1.0
        price_move_n = pm_sign * _apply_sensitivity(abs(price_move_n), sens_exp)

    data = {
        "heat": round(heat_n, 4),
        "price": round(price_n, 4),
        "price_move": round(price_move_n, 4),
        "momentum": round(momentum_n, 4),
        "velocity": round(velocity_n, 4),
        "trade_rate": round(trade_rate_n, 4),
        "spread": round(spread_n, 4),
        "volatility": round(volatility_n, 4),
        "tone": tone,
        "sensitivity": round(session.sensitivity, 4),
    }
    return data, events


async def broadcast_loop(interval=None):
    """Push market data to all connected clients every interval seconds."""
    if interval is None:
        interval = DATA_PUSH_INTERVAL
    rotation_counter = 0
    rotation_every = max(1, int(RESCORE_INTERVAL / DATA_PUSH_INTERVAL))  # ~10 cycles = 30s
    try:
        while True:
            await asyncio.sleep(interval)

            # Check live finance rotations every ~30s
            rotation_counter += 1
            if rotation_counter >= rotation_every:
                rotation_counter = 0
                await _check_live_rotations()

            for session in state.sessions.all_sessions():
                if not session.asset_id:
                    continue
                try:
                    data, events = _compute_market_data(session, state.scorer)
                    if data:
                        await session.ws.send_json({"type": "market_data", "data": data})
                    for evt in events:
                        await session.ws.send_json({"type": "event", **evt})
                except (ConnectionResetError, ConnectionError):
                    pass
                except Exception as e:
                    print(f"[BROADCAST] Error for {session.client_id}: {e}", flush=True)
    except asyncio.CancelledError:
        pass


# ── Market selection helpers ──────────────────────────────

async def _pin_market_for_session(session: ClientSession, slug: str):
    """Pin a market for a specific client session."""
    import polymarket.gamma as gamma_module

    # Unwatch previous market
    if session.asset_id:
        state.sessions.unwatch_market(session.client_id, session.asset_id)

    # Find market in DJ's list
    market = next((m for m in state.dj.all_markets if m["slug"] == slug), None)

    # If not found, fetch from API
    if not market:
        market = await asyncio.to_thread(gamma_module.fetch_market_by_slug, slug)
        if market and market.get("asset_ids"):
            state.dj.all_markets.append(market)
            for aid in market["asset_ids"]:
                state.scorer.set_volume(aid, market.get("volume", 0))

    if not market or not market.get("asset_ids"):
        return {"error": f"Market not found: {slug}"}

    aid = AutonomousDJ._primary_asset(market)
    session.market_slug = slug
    session.asset_id = aid
    session.market = market
    session.reset_event_state()
    session._prev_asset = aid
    session._prev_price = 0.5
    session._current_tone = 1

    # Seed prices
    state.dj._seed_prices(market)

    # Watch and subscribe if needed
    is_first = state.sessions.watch_market(session.client_id, aid)
    if is_first and state.feed and aid not in state.feed.subscribed:
        await state.feed.update_subscriptions(add=[aid], remove=[])

    print(f"[WS:{session.client_id}] Pinned: {slug} (asset {aid[:8]}...)", flush=True)

    # Send market info to client
    await session.ws.send_json({
        "type": "market_info",
        "market": {
            "question": market["question"],
            "slug": market["slug"],
            "event_slug": market.get("event_slug", ""),
            "outcomes": market.get("outcomes", []),
            "link": f"https://polymarket.com/event/{market.get('event_slug', slug)}",
        }
    })
    return {"ok": True}


async def _play_url_for_session(session: ClientSession, url: str):
    """Parse a Polymarket URL and pin the market for a session."""
    import polymarket.gamma as gamma_module

    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        if len(parts) < 2 or parts[0] != "event":
            return {"error": "Invalid URL format. Expected: polymarket.com/event/..."}
        event_slug = parts[1]
        market_slug = parts[2] if len(parts) >= 3 else None
    except Exception:
        return {"error": "Could not parse URL"}

    try:
        market = None
        if market_slug:
            market = await asyncio.to_thread(gamma_module.fetch_market_by_slug, market_slug)
        if not market:
            event_markets = await asyncio.to_thread(gamma_module.fetch_markets_by_event_slug, event_slug)
            if event_markets:
                market = event_markets[0]

        if not market or not market.get("asset_ids"):
            return {"error": f"No tradeable market found for: {event_slug}"}

        # Inject into DJ's list
        existing = next((m for m in state.dj.all_markets if m["slug"] == market["slug"]), None)
        if not existing:
            state.dj.all_markets.append(market)
            for aid in market["asset_ids"]:
                state.scorer.set_volume(aid, market.get("volume", 0))
            if state.feed:
                new_ids = [aid for aid in market["asset_ids"] if aid not in state.feed.subscribed]
                if new_ids:
                    await state.feed.update_subscriptions(add=new_ids, remove=[])

        return await _pin_market_for_session(session, market["slug"])
    except Exception as e:
        print(f"[PLAY_URL] Error: {e}", flush=True)
        return {"error": "Failed to load market from URL"}


# ── Per-session live finance rotation ─────────────────────

async def _play_live_prefix(session: ClientSession, prefix: str):
    """Resolve a live finance prefix (e.g. 'btc-updown-15m') to the current market and pin it."""
    import polymarket.gamma as gamma_module

    try:
        live = await asyncio.to_thread(gamma_module.fetch_live_finance_markets)
        if not live:
            return {"error": "No live finance markets available"}

        match = next(
            (m for m in live if m.get("event_slug", "").startswith(prefix) and m.get("asset_ids")),
            None,
        )
        if not match:
            return {"error": f"No live market found for prefix: {prefix}"}

        # Inject into DJ's list so _pin_market_for_session finds it
        existing = next((m for m in state.dj.all_markets if m["slug"] == match["slug"]), None)
        if not existing:
            state.dj.all_markets.append(match)
            for aid in match.get("asset_ids", []):
                state.scorer.set_volume(aid, match.get("volume", 0))

        print(f"[LIVE:{session.client_id}] play_live prefix='{prefix}' → {match.get('event_slug', '?')}", flush=True)
        return await _pin_market_for_session(session, match["slug"])
    except Exception as e:
        print(f"[LIVE:{session.client_id}] play_live error: {e}", flush=True)
        return {"error": "Failed to load live market"}


async def _rotate_session_to_next_live(session: ClientSession, reason: str = "expired"):
    """Rotate a client session from an expired live finance market to the next one."""
    import polymarket.gamma as gamma_module

    old_market = session.market
    old_slug = old_market.get("event_slug", "") if old_market else ""

    print(f"[LIVE:{session.client_id}] Rotating from {old_slug} ({reason})...", flush=True)

    try:
        live = await asyncio.to_thread(gamma_module.fetch_live_finance_markets)
        if not live:
            print(f"[LIVE:{session.client_id}] No next live market found, will retry", flush=True)
            return

        # Extract prefix like "btc-updown-15m" or "bitcoin-up-or-down"
        prefix = re.sub(r"-\d+$", "", old_slug)          # strip trailing timestamp
        prefix = re.sub(r"-[a-z]+-\d+-\d+-\d+[ap]m-et$", "", prefix)  # strip date suffix

        # Match same pattern, different slug
        match = None
        for m in live:
            es = m.get("event_slug", "")
            if es.startswith(prefix) and m["asset_ids"] and es != old_slug:
                match = m
                break
        # Fallback: any live market with a different slug
        if not match:
            match = next((m for m in live if m["asset_ids"] and m.get("event_slug", "") != old_slug), None)
        # Last resort: same slug (may still be the only one available)
        if not match:
            match = next((m for m in live if m["asset_ids"]), None)
        if not match:
            print(f"[LIVE:{session.client_id}] No tradeable live market found", flush=True)
            return

        new_slug = match.get("event_slug", "?")
        print(f"[LIVE:{session.client_id}] → {new_slug} — {match['question'][:50]}", flush=True)

        # Inject into DJ's list so _pin_market_for_session finds it
        existing = next((m for m in state.dj.all_markets if m["slug"] == match["slug"]), None)
        if not existing:
            state.dj.all_markets.append(match)

        await _pin_market_for_session(session, match["slug"])

    except Exception as e:
        print(f"[LIVE:{session.client_id}] Rotation failed: {e}", flush=True)


def _infer_end_time(event_slug: str):
    """Infer end time from a live finance event slug when end_date is missing.
    Returns a datetime (UTC) or None."""
    # Timestamp-based: btc-updown-15m-1774385100 → timestamp + interval
    m = re.match(r"^(?:btc|eth)-updown-(\d+)m-(\d+)$", event_slug)
    if m:
        interval_min, ts = int(m.group(1)), int(m.group(2))
        return datetime.fromtimestamp(ts + interval_min * 60, tz=timezone.utc)
    # Hourly: bitcoin-up-or-down-march-25-2026-3pm-et → next hour boundary
    m = re.match(r"^bitcoin-up-or-down-(\w+)-(\d+)-(\d+)-(\d+)(am|pm)-et$", event_slug)
    if m:
        import calendar
        month_name, day, year, hour, ampm = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(5)
        # Convert 12-hour to 24-hour
        if ampm == "am" and hour == 12:
            hour = 0
        elif ampm == "pm" and hour != 12:
            hour += 12
        # Parse month name
        month_names = {v.lower(): k for k, v in enumerate(calendar.month_name) if k}
        month_num = month_names.get(month_name, 1)
        # Determine ET offset (EDT=-4 Mar-Nov, EST=-5 Nov-Mar) same as gamma._now_et
        utc_now = datetime.now(timezone.utc)
        mar1 = datetime(utc_now.year, 3, 1, tzinfo=timezone.utc)
        dst_start = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7, hours=7)
        nov1 = datetime(utc_now.year, 11, 1, tzinfo=timezone.utc)
        dst_end = nov1 + timedelta(days=(6 - nov1.weekday()) % 7, hours=6)
        et_offset_hours = 4 if dst_start <= utc_now < dst_end else 5
        # Slug hour is in ET; convert to UTC and add 1 hour for end time
        end_utc = datetime(year, month_num, day, hour, 0, 0, tzinfo=timezone.utc) + timedelta(hours=et_offset_hours + 1)
        return end_utc
    return None


async def _check_live_rotations():
    """Check all sessions for expired live finance markets and rotate them."""
    for session in state.sessions.all_sessions():
        market = session.market
        if not market:
            continue
        if not AutonomousDJ._is_live_finance(market):
            continue
        end_str = market.get("end_date")
        end_dt = None
        if end_str:
            try:
                end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            except (ValueError, TypeError):
                pass
        # If end_date missing or unparseable, infer from slug pattern
        if not end_dt:
            event_slug = market.get("event_slug", "")
            end_dt = _infer_end_time(event_slug)
            if end_dt:
                print(f"[LIVE:{session.client_id}] Inferred end_time from slug: {event_slug} → {end_dt.isoformat()}", flush=True)
            else:
                print(f"[LIVE:{session.client_id}] No end_date and can't infer from slug: {event_slug}", flush=True)
                continue
        now_utc = datetime.now(timezone.utc)
        remaining = (end_dt - now_utc).total_seconds()
        if remaining > 0:
            if remaining < 120:
                mins, secs = int(remaining // 60), int(remaining % 60)
                slug = market.get("event_slug", "?")
                print(f"[LIVE:{session.client_id}] {slug} ends in {mins}m{secs}s", flush=True)
            continue

        await _rotate_session_to_next_live(session, "expired")


async def _handle_resolution_for_sessions(msg: dict):
    """Handle market resolution for per-client sessions."""
    resolved_ids = set(msg.get("assets_ids", []))
    if not resolved_ids:
        return

    for session in state.sessions.all_sessions():
        if session.asset_id not in resolved_ids:
            continue

        was_live = AutonomousDJ._is_live_finance(session.market) if session.market else False
        if was_live:
            await _rotate_session_to_next_live(session, "resolved")
        else:
            try:
                await session.ws.send_json({"type": "event", "event": "market_ended"})
            except Exception:
                pass


# ── WebSocket handler ─────────────────────────────────────

async def handle_ws(request):
    """WebSocket endpoint for browser clients."""
    if state.sessions.active_count >= MAX_CLIENTS:
        return web.Response(status=503, text="Server full")

    ws = web.WebSocketResponse(heartbeat=WS_PING_INTERVAL)
    await ws.prepare(request)

    session = ClientSession(ws)
    state.sessions.add(session)
    print(f"[WS:{session.client_id}] Connected ({state.sessions.active_count} clients)", flush=True)

    # Send initial status
    await ws.send_json({
        "type": "status",
        "data": {
            "tracks": [
                {"name": name, "label": info["label"], "category": info["category"]}
                for name, info in state.tracks.items()
            ],
            "categories": BROWSE_CATEGORIES,
        }
    })

    try:
        async for raw_msg in ws:
            if raw_msg.type == web.WSMsgType.TEXT:
                try:
                    msg = json.loads(raw_msg.data)
                    action = msg.get("action")

                    if action == "pin":
                        slug = msg.get("slug", "")
                        if slug:
                            result = await _pin_market_for_session(session, slug)
                            if "error" in result:
                                await ws.send_json({"type": "error", "message": result["error"]})

                    elif action == "play_url":
                        url = msg.get("url", "")
                        if url:
                            result = await _play_url_for_session(session, url)
                            if "error" in result:
                                await ws.send_json({"type": "error", "message": result["error"]})

                    elif action == "play_live":
                        prefix = msg.get("prefix", "")
                        if prefix:
                            result = await _play_live_prefix(session, prefix)
                            if "error" in result:
                                await ws.send_json({"type": "error", "message": result["error"]})

                    elif action == "unpin":
                        if session.asset_id:
                            state.sessions.unwatch_market(session.client_id, session.asset_id)
                        session.market_slug = None
                        session.asset_id = None
                        session.market = None
                        session.reset_event_state()
                        await ws.send_json({"type": "market_info", "market": None})

                    elif action == "sensitivity":
                        val = msg.get("value", DEFAULT_SENSITIVITY)
                        session.sensitivity = max(0.0, min(1.0, float(val)))

                    elif action == "track":
                        name = msg.get("name", "")
                        if name in state.tracks:
                            session.track = name

                except json.JSONDecodeError:
                    pass
                except Exception as e:
                    print(f"[WS:{session.client_id}] Handler error: {e}", flush=True)

            elif raw_msg.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break

    finally:
        state.sessions.remove(session.client_id)
        print(f"[WS:{session.client_id}] Disconnected ({state.sessions.active_count} clients)", flush=True)

    return ws


# ── DJ event callback ─────────────────────────────────────

async def _on_dj_event(event_type: str, data: dict):
    """Broadcast DJ events (resolution, ambient mode) to relevant clients."""
    for session in state.sessions.all_sessions():
        try:
            await session.ws.send_json({"type": "event", "event": event_type, **data})
        except Exception:
            pass


async def _on_market_ended():
    """Notify clients when a non-live-finance market resolves."""
    print("[SERVER] Market ended (resolved)", flush=True)
    for session in state.sessions.all_sessions():
        if session.market and not AutonomousDJ._is_live_finance(session.market):
            try:
                await session.ws.send_json({"type": "event", "event": "market_ended"})
            except Exception:
                pass


# ── HTTP API handlers (stateless) ─────────────────────────

async def handle_index(request):
    """Serve the main page."""
    index_path = Path("frontend/index.html")
    if index_path.exists():
        return web.FileResponse(index_path)
    return web.Response(text="Frontend not found. Run from project root.", status=404)


async def handle_browse(request):
    """Browse markets by category."""
    import polymarket.gamma as gamma_module
    tag_id = request.query.get("tag_id")
    sort = request.query.get("sort", "volume")
    limit = min(int(request.query.get("limit", "10")), 50)
    try:
        if tag_id == "live":
            markets = gamma_module.fetch_live_finance_markets()
        else:
            tag_id_int = int(tag_id) if tag_id else None
            markets = gamma_module.fetch_browse_markets(tag_id=tag_id_int, limit=limit, sort=sort)

        result = []
        for m in markets:
            prices = m.get("outcome_prices", [])
            outcomes = m.get("outcomes", [])
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
        print(f"[BROWSE] Error: {e}", flush=True)
        return web.json_response({"error": "Failed to fetch markets"}, status=500)


async def handle_categories(request):
    """Return available browse categories."""
    return web.json_response({"categories": BROWSE_CATEGORIES})


# ── App setup ─────────────────────────────────────────────

async def on_startup(app):
    """Start Polymarket feed and DJ on server boot."""
    import polymarket.gamma as gamma_module

    state.dj = AutonomousDJ(state.scorer, None, gamma_module, on_event=_on_dj_event)
    state.dj.on_market_ended = _on_market_ended

    def _on_resolution(msg):
        state.dj.on_market_resolved(msg)
        asyncio.ensure_future(_handle_resolution_for_sessions(msg))

    state.feed = PolymarketFeed(state.scorer, on_resolution=_on_resolution)
    state.dj.feed = state.feed

    # Re-discover tracks
    state.tracks = state._find_tracks()

    print("[SERVER] Starting Polymarket feed...", flush=True)
    state._feed_task = asyncio.create_task(feed_loop())
    state._dj_task = asyncio.create_task(dj_loop())
    state._push_task = asyncio.create_task(broadcast_loop())
    state._price_task = asyncio.create_task(price_poll_loop())
    print("[SERVER] Feed, DJ, and broadcast started.", flush=True)


async def on_shutdown(app):
    """Clean shutdown."""
    for task in [state._feed_task, state._dj_task, state._push_task, state._price_task]:
        if task:
            task.cancel()
    print("[SERVER] Shut down.", flush=True)


def create_app():
    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # Main page
    app.router.add_get("/", handle_index)

    # WebSocket
    app.router.add_get("/ws", handle_ws)

    # Stateless API endpoints
    app.router.add_get("/api/browse", handle_browse)
    app.router.add_get("/api/categories", handle_categories)

    # Static files (frontend/)
    frontend_path = Path("frontend")
    if frontend_path.exists():
        app.router.add_static("/static/", path=str(frontend_path), name="static")

    return app


if __name__ == "__main__":
    print("""
    +==========================================+
    |    THE POLYMARKET DJ — WEB SERVER        |
    |    http://localhost:8888                  |
    +==========================================+
    """, flush=True)
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8888, print=lambda msg: print(f"[SERVER] {msg}", flush=True))
