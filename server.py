"""
Data as Music (dam.fm) — Web Server

Data-only server: connects to prediction market APIs, scores markets,
and pushes normalized data to browser clients via WebSocket. Audio runs
entirely in the browser via Strudel.

    python server.py
    # Open http://localhost:8888
"""
import asyncio
import hashlib
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

from market.scorer import MarketScorer
from market.websocket import MarketFeed
from mixer.mixer import AutonomousDJ
from sessions import ClientSession, SessionManager
from config import (
    RESCORE_INTERVAL, BROWSE_CATEGORIES,
    DEFAULT_SENSITIVITY, EVENT_HEAT_THRESHOLD, EVENT_PRICE_THRESHOLD,
    WS_PING_INTERVAL, MAX_CLIENTS, DATA_PUSH_INTERVAL,
    VELOCITY_MAX_MOVE, WARMUP_TICKS,
    PRICE_MOVE_HL_MIN, PRICE_MOVE_HL_MAX, PRICE_MOVE_GAIN,
    PRICE_DELTA_TICKS_MIN, PRICE_DELTA_TICKS_MAX,
)


# ── Global state ──────────────────────────────────────────

class AppState:
    def __init__(self):
        self.scorer = MarketScorer()
        self.dj: AutonomousDJ | None = None
        self.feed: MarketFeed | None = None
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


def sensitivity_timescale(s: float) -> float:
    """Canonical mapping from sensitivity slider (0-1) to timescale in seconds.

    This is the single knob the user turns. Every sensitivity-aware signal
    derives its smoothing / decay / window from this value. Log-uniform so
    the slider feels linear across the range:

      s=1.0 → PRICE_MOVE_HL_MIN  (15 s)    scalper    — reacts to every flicker
      s=0.5 → ≈ geometric mean   (~4 min)  intraday   — the default
      s=0.0 → PRICE_MOVE_HL_MAX  (1 hr)    news       — only massive moves register
    """
    return PRICE_MOVE_HL_MIN * (PRICE_MOVE_HL_MAX / PRICE_MOVE_HL_MIN) ** (1.0 - s)


# Half-life at the default sensitivity (0.5). Used as the anchor for event
# threshold scaling so a tick-delta that counts as "significant" at the
# default setting stays at its face value and gets scaled proportionally
# toward/away from that at other settings.
_DEFAULT_HALF_LIFE = PRICE_MOVE_HL_MIN * (PRICE_MOVE_HL_MAX / PRICE_MOVE_HL_MIN) ** 0.5


def _event_threshold_scale(half_life: float) -> float:
    """Multiplier for event magnitude thresholds given a session's half-life.

    Uses √(half_life / default) so thresholds scale like a random walk: a
    typical price excursion over timescale t grows as √t. At the 15 s
    scalper preset this makes even small moves fire events; at the 1 hr
    news preset, only ~10¢ jumps do. Reduces to ≈1.0 at s=0.5 (default),
    and almost exactly matches the old sens_exp range at s=1 / s=0, but
    cleanly extends to 1 hr without arbitrary multipliers.
    """
    return (half_life / _DEFAULT_HALF_LIFE) ** 0.5


def _sensitivity_exponent(s: float) -> float:
    """Power-curve exponent for intensity signals (heat/trade_rate/spread).

    Shorter timescale (scalper) → inflates values; longer timescale (news)
    → compresses them. Range 0.25 (s=1) to 4.0 (s=0). Derived from the
    canonical sensitivity_timescale, though the mapping shape is preserved
    from the legacy curve to avoid behavior regressions on intensity signals.
    """
    return 4.0 ** (1.0 - 2.0 * s)


def _apply_sensitivity(value: float, exponent: float) -> float:
    """Apply power curve: value^exponent, clamped 0-1."""
    if value <= 0.0:
        return 0.0
    return max(0.0, min(1.0, value ** exponent))


def _leaky_integrator_k(sensitivity: float) -> float:
    """Per-tick decay rate for the price_move leaky integrator.

    Half-life equals sensitivity_timescale. Returned value is the fraction
    decayed per DATA_PUSH_INTERVAL tick, so `pm_v *= (1 - k)` each tick
    before the new delta is added.
    """
    half_life = sensitivity_timescale(sensitivity)
    return 1.0 - 2.0 ** (-DATA_PUSH_INTERVAL / half_life)


def _sensitivity_window(sensitivity: float) -> int:
    """Window length in samples for velocity / volatility / momentum stats.

    Capped by MID_HISTORY_MAXLEN (~10 min of buffer) — long-horizon
    presets (1 hr) would otherwise want more history than the scorer
    stores. Legacy exponential curve preserved here (15 → 160 entries
    across s=1..0) so intensity-adjacent signals don't regress; the
    canonical sensitivity_timescale governs the vector signal's half-life
    independently.
    """
    return max(4, int(160 * (15 / 160) ** sensitivity))


def _compute_window_cap(market: dict | None) -> int | None:
    """Max sensitivity-window entries appropriate for a market's lifetime.

    Returns None when the market has no end_date or more than an hour of life
    left — those are long-lived and the regular sensitivity curve is fine.

    For short-lived markets (< 1 hour remaining at pin time, e.g. 5-min and
    15-min live-finance contracts), caps the window at half the remaining
    lifetime so the rolling buffer can actually fill before the market
    resolves. Floor of 10 entries (30s) keeps signals meaningful on the
    last-minute-of-a-5min-market edge case.
    """
    if not market:
        return None
    end_str = market.get("end_date")
    if not end_str:
        return None
    try:
        end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    remaining = (end_dt - datetime.now(timezone.utc)).total_seconds()
    if remaining <= 0 or remaining > 3600:
        return None
    return max(10, int(remaining / 2 / DATA_PUSH_INTERVAL))


def _warmup_factor(session: ClientSession) -> float:
    """Smooth 0→1 tween over WARMUP_TICKS broadcast ticks since rotation.
    Uses smoothstep (3t²-2t³) for a gradual ease-in.

    Tick-based (not time-based) because the binding constraint is the
    rolling-median smoother flushing backfilled samples — that's a
    discrete tick count, not a wallclock duration. While w<1.0 the
    server hard-zeroes change-based signals and freezes integrator
    state so post-warmup baselines are clean.
    """
    t = session._ticks_since_rotation
    if t >= WARMUP_TICKS:
        return 1.0
    x = t / WARMUP_TICKS
    return x * x * (3.0 - 2.0 * x)


def _price_delta_lookback_ticks(sensitivity: float) -> int:
    """Lookback window in ticks for the price_delta_cents signal.

    Log-uniform mapping from sensitivity to tick count:
      s=1.0 → PRICE_DELTA_TICKS_MIN  (5 ticks ≈ 15s, scalper)
      s=0.5 → geometric mean         (~22 ticks ≈ 66s, default)
      s=0.0 → PRICE_DELTA_TICKS_MAX  (100 ticks ≈ 5min, news)
    """
    ratio = PRICE_DELTA_TICKS_MAX / PRICE_DELTA_TICKS_MIN
    return max(1, round(PRICE_DELTA_TICKS_MIN * ratio ** (1.0 - sensitivity)))


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
    """Run the market WebSocket feed."""
    print("[FEED] Starting market feed...", flush=True)
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
    import market.gamma as gamma_module
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
    Returns (data_dict, events_list) or (None, []) if no market.

    The price-derived signals all read from the scorer's smoothed mid
    history (`scorer.price_history`), which is sampled once per broadcast
    tick via `scorer.sample_mid(aid)` and pre-smoothed by a rolling
    median. That single clean series feeds velocity, volatility, momentum,
    price_move and tone — no separate per-session history is kept.
    """
    aid = session.asset_id
    market = session.market
    if not aid or not market:
        return None, []

    # ── Price: smoothed mid from scorer, fall back to API ─────
    smoothed_mid = scorer.get_smoothed_mid(aid)
    api_price = _get_api_price(market, aid)
    last_price = (
        smoothed_mid if smoothed_mid is not None
        else (api_price if api_price is not None else 0.5)
    )

    # ── Sensitivity configuration ─────────────────────────────
    # sensitivity_timescale is the canonical knob. sens_exp and sens_window
    # are legacy-shape mappings preserved for intensity and windowed stats;
    # half_life drives the leaky integrator and event-threshold scaling.
    half_life = sensitivity_timescale(session.sensitivity)
    sens_exp = _sensitivity_exponent(session.sensitivity)
    sens_window = _sensitivity_window(session.sensitivity)
    if session._market_window_cap is not None:
        sens_window = min(sens_window, session._market_window_cap)
    sens_window_seconds = sens_window * DATA_PUSH_INTERVAL
    event_scale = _event_threshold_scale(half_life)

    # ── Rotation: reset per-session state when the market changes ──
    events = []
    is_rotation = (aid != session._prev_asset)
    if is_rotation:
        session._prev_asset = aid
        session._prev_heat = scorer.heat(aid)
        session._prev_price = last_price
        session._prev_price_move = 0.0
        session.pm_v = 0.0
        session._prev_smoothed_mid = smoothed_mid  # may be None if no feed data yet
        session._current_tone = 1 if last_price > 0.5 else 0
        session._ema_fast = last_price
        session._ema_slow = last_price
        session._ticks_since_rotation = 0

    # Increment tick counter (post-rotation reset starts at 0; first
    # post-rotation tick becomes 1).
    session._ticks_since_rotation += 1

    # ── Tone hysteresis (on smoothed price) ───────────────────
    if session._current_tone == 1 and last_price < 0.45:
        session._current_tone = 0
    elif session._current_tone == 0 and last_price > 0.55:
        session._current_tone = 1
    tone = session._current_tone

    # ── Activity signals: heat / trade_rate / spread (power curve) ──
    heat = scorer.heat(aid)                    # uses fixed 5-min velocity internally
    trade_rate = scorer.trade_rate(aid)
    spread_raw = scorer.get_smoothed_spread(aid)

    heat_n       = _apply_sensitivity(max(0.0, min(1.0, heat)), sens_exp)
    trade_rate_n = _apply_sensitivity(max(0.0, min(1.0, trade_rate)), sens_exp)
    spread_n     = _apply_sensitivity(_scale(spread_raw, 0, 0.3, 0.0, 1.0), sens_exp)
    price_n      = max(0.0, min(1.0, last_price))

    # ── Window-family signals read from scorer's smoothed history ──
    # velocity / volatility / momentum / price_move all share the same
    # sens-scaled window so sensitivity acts as one consistent knob
    # (timescale), and all derive from the same smoothed samples.
    recent = scorer.get_recent_mids(aid, sens_window_seconds)
    recent_prices = [p for _, p in recent]

    # Velocity: max-min excursion over the sens window, unsigned.
    # Distinct from price_move (signed, endpoint) and volatility (stddev).
    if len(recent_prices) >= 2:
        velocity_n = min(1.0, (max(recent_prices) - min(recent_prices)) / VELOCITY_MAX_MOVE)
    else:
        velocity_n = 0.0

    # Volatility: stddev over the same window, normalized to 3¢ = 1.0.
    if len(recent_prices) >= 2:
        mean_p = sum(recent_prices) / len(recent_prices)
        variance = sum((p - mean_p) ** 2 for p in recent_prices) / len(recent_prices)
        volatility_n = min(1.0, variance ** 0.5 / 0.03)
    else:
        volatility_n = 0.0

    # Momentum: dual-EMA on the smoothed mid. Updated every tick.
    # Fast period = window/3, slow = window. ±5¢ divergence → ±1.0.
    alpha_fast = 2.0 / (sens_window / 3 + 1)
    alpha_slow = 2.0 / (sens_window + 1)
    session._ema_fast += alpha_fast * (last_price - session._ema_fast)
    session._ema_slow += alpha_slow * (last_price - session._ema_slow)
    momentum_n = max(-1.0, min(1.0, (session._ema_fast - session._ema_slow) / 0.05))

    # ── Event detection ───────────────────────────────────────
    # Thresholds scale as √(half_life / default) — a random-walk-like scaling
    # where a "typical" move over timescale t grows as √t. At the 15 s
    # scalper preset small moves fire events; at 1 hr only ≥10¢ jumps do.
    if not is_rotation:
        heat_delta = abs(heat - session._prev_heat)
        raw_price_delta = last_price - session._prev_price
        abs_price_delta = abs(raw_price_delta)
        if heat_delta > EVENT_HEAT_THRESHOLD * event_scale:
            spike_mag = min(1.0, heat_delta / (EVENT_HEAT_THRESHOLD * 3))
            events.append({"event": "spike", "magnitude": round(spike_mag, 4)})
        if abs_price_delta > EVENT_PRICE_THRESHOLD * event_scale:
            direction = 1 if raw_price_delta > 0 else -1
            step_mag = min(1.0, abs_price_delta / (EVENT_PRICE_THRESHOLD * 3))
            # `price_step` — per-tick raw price jump. Distinct from the
            # continuous `price_move` leaky-integrator signal (which is
            # decaying). See docs/development/signal-primitives.md.
            events.append({"event": "price_step", "direction": direction, "magnitude": round(step_mag, 4)})
    session._prev_heat = heat
    session._prev_price = last_price

    # ── Price_move: leaky integrator of signed mid deltas ─────
    # pm_v accumulates g·Δmid with per-tick decay k (derived from sensitivity
    # → half-life). Direction = sign, magnitude = |pm_v|, natural return to
    # zero when price is flat. Replaces the old window-diff + edge-detector
    # stack. See docs/development/signal-primitives.md.
    if smoothed_mid is not None and session._prev_smoothed_mid is not None:
        delta_mid = smoothed_mid - session._prev_smoothed_mid
    else:
        delta_mid = 0.0

    k = _leaky_integrator_k(session.sensitivity)
    session.pm_v = (1.0 - k) * session.pm_v + PRICE_MOVE_GAIN * delta_mid
    session.pm_v = max(-1.0, min(1.0, session.pm_v))
    if smoothed_mid is not None:
        session._prev_smoothed_mid = smoothed_mid

    price_move_n = session.pm_v

    # ── Price delta (cents): canonical change signal ─────────
    # Signed delta over a sensitivity-scaled tick window on the scorer's
    # smoothed mid. Sign = direction, magnitude = cents moved. The
    # lookback never reaches past the rotation boundary (clamped to
    # `_ticks_since_rotation - WARMUP_TICKS`), so the median flush and
    # any backfill/live transition artifacts are excluded.
    lookback_target = _price_delta_lookback_ticks(session.sensitivity)
    post_warmup_ticks = max(0, session._ticks_since_rotation - WARMUP_TICKS)
    lookback = min(lookback_target, post_warmup_ticks)
    hist = scorer.price_history.get(aid)
    past_mid = None
    if hist and lookback >= 1 and len(hist) > lookback and smoothed_mid is not None:
        past_mid = hist[-1 - lookback][1]
        price_delta_cents = (smoothed_mid - past_mid) * 100.0
    else:
        price_delta_cents = 0.0

    print(
        f"[DATA:{session.client_id}] t={session._ticks_since_rotation} "
        f"mid={smoothed_mid if smoothed_mid is None else round(smoothed_mid, 5)} "
        f"hist_len={len(hist) if hist else 0} "
        f"lookback={lookback}/{lookback_target} "
        f"past_mid={past_mid if past_mid is None else round(past_mid, 5)} "
        f"Δ¢={price_delta_cents:+.3f} "
        f"sens={session.sensitivity:.2f}",
        flush=True,
    )

    # ── Warmup: tween continuous signals, freeze change-based state ──
    w = _warmup_factor(session)
    if w < 1.0:
        # Fade-in for ambient/continuous signals (heat, momentum, etc.)
        heat_n *= w
        velocity_n *= w
        trade_rate_n *= w
        spread_n *= w
        volatility_n *= w
        momentum_n *= w
        # Hard-zero change-based signals: the median smoother is still
        # flushing backfilled samples, so any apparent "delta" is a
        # statistical artifact of that flush, not a real price move.
        price_move_n = 0.0
        price_delta_cents = 0.0
        events = []
        # Freeze integrator state so post-warmup baselines are clean —
        # pm_v and EMAs would otherwise accumulate the flush as noise
        # and carry it into the first real broadcast.
        session.pm_v = 0.0
        if smoothed_mid is not None:
            session._prev_smoothed_mid = smoothed_mid
        session._ema_fast = last_price
        session._ema_slow = last_price
        session._prev_heat = heat
        session._prev_price = last_price

    # Window metadata for client visualisation: target window for the
    # sensitivity-scaled signals, and how much of that window is actually
    # backed by buffered history (fills from 0→1 over up to 8 min after
    # a market switch at low sensitivity).
    window_fill = min(1.0, len(recent) / sens_window) if sens_window > 0 else 1.0

    data = {
        "heat": round(heat_n, 4),
        "price": round(price_n, 4),
        "price_move": round(price_move_n, 4),
        "price_delta_cents": round(price_delta_cents, 3),
        "momentum": round(momentum_n, 4),
        "velocity": round(velocity_n, 4),
        "trade_rate": round(trade_rate_n, 4),
        "spread": round(spread_n, 4),
        "volatility": round(volatility_n, 4),
        "tone": tone,
        "sensitivity": round(session.sensitivity, 4),
        "window_seconds": sens_window_seconds,
        "window_fill": round(window_fill, 4),
        "warmup_factor": round(w, 4),
        "ticks_since_rotation": session._ticks_since_rotation,
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

            # Sample the mid once per watched market so the scorer's
            # smoothed history advances at a regular cadence regardless
            # of how many sessions are watching it.
            sessions = state.sessions.all_sessions()
            watched_assets = {s.asset_id for s in sessions if s.asset_id}
            for aid in watched_assets:
                state.scorer.sample_mid(aid)

            for session in sessions:
                if not session.asset_id:
                    continue
                try:
                    data, events = _compute_market_data(session, state.scorer)
                    if data:
                        await session.ws.send_json({"type": "market_data", "data": data})
                    for evt in events:
                        await session.ws.send_json({"type": "event", **evt})
                except (ConnectionResetError, ConnectionError):
                    # Socket is dead — close it so handle_ws exits its loop
                    # and the client's auto-reconnect kicks in
                    try:
                        await session.ws.close()
                    except Exception:
                        pass
                except Exception as e:
                    print(f"[BROADCAST] Error for {session.client_id}: {e}", flush=True)
    except asyncio.CancelledError:
        pass


# ── Market selection helpers ──────────────────────────────

async def _pin_market_for_session(session: ClientSession, slug: str):
    """Pin a market for a specific client session."""
    import market.gamma as gamma_module

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
    session._market_window_cap = _compute_window_cap(market)

    # Watch and subscribe if needed
    is_first = state.sessions.watch_market(session.client_id, aid)
    if is_first and state.feed and aid not in state.feed.subscribed:
        await state.feed.update_subscriptions(add=[aid], remove=[])

    # Seed price history from the CLOB so window-based signals have data
    # on the first broadcast tick. Awaited (not fire-and-forget) so the
    # history is in place before the next tick — adds ~0.5-1s to pin
    # latency but avoids a half-populated buffer on the first frame.
    # Returns 0 for freshly-opened short-lived markets (live finance);
    # the adaptive-window cap handles those.
    import market.clob_history as clob_history
    try:
        seeded = await clob_history.backfill_scorer(state.scorer, aid)
        if seeded:
            print(f"[WS:{session.client_id}] Backfilled {seeded} price points for {slug}", flush=True)
    except Exception as e:
        print(f"[WS:{session.client_id}] Backfill error for {slug}: {e}", flush=True)

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
    """Parse a market URL and pin the market for a session."""
    import market.gamma as gamma_module

    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/")
        parts = [p for p in path.split("/") if p]
        if len(parts) < 2 or parts[0] != "event":
            return {"error": "Invalid URL format. Expected: .../event/slug"}
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
    import market.gamma as gamma_module

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
    import market.gamma as gamma_module

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

async def _broadcast_listener_count():
    """Send current listener count to all connected clients."""
    count = state.sessions.active_count
    for session in state.sessions.all_sessions():
        try:
            await session.ws.send_json({"type": "listeners", "count": count})
        except Exception:
            pass


async def handle_ws(request):
    """WebSocket endpoint for browser clients."""
    if state.sessions.active_count >= MAX_CLIENTS:
        return web.Response(status=503, text="Server full")

    ws = web.WebSocketResponse(heartbeat=WS_PING_INTERVAL)
    await ws.prepare(request)

    session = ClientSession(ws)
    state.sessions.add(session)
    print(f"[WS:{session.client_id}] Connected ({state.sessions.active_count} clients)", flush=True)

    # Notify all clients of updated listener count
    await _broadcast_listener_count()

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
        await _broadcast_listener_count()

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


# ── Static file cache-busting ─────────────────────────────

def _file_hash(path: Path) -> str:
    """Return first 8 chars of MD5 hex digest for a file."""
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]


def _build_static_hashes() -> dict[str, str]:
    """Compute content hashes for all frontend static files."""
    frontend = Path("frontend")
    hashes = {}
    for p in frontend.rglob("*"):
        if p.is_file() and p.suffix in (".css", ".js"):
            rel = p.relative_to(frontend)
            hashes[f"/static/{rel}"] = _file_hash(p)
    return hashes


# Computed once at startup; restart to pick up new file hashes
_static_hashes: dict[str, str] = {}


def _cache_bust_html(html: str) -> str:
    """Replace /static/foo.ext with /static/foo.ext?h=<hash> in HTML."""
    def _replace(m):
        path = m.group(0)
        h = _static_hashes.get(path)
        return f"{path}?h={h}" if h else path
    return re.sub(r'/static/[\w./-]+\.(?:css|js)', _replace, html)


def _serve_html(path: Path, missing_msg: str):
    """Serve an HTML file with cache-busted static URLs."""
    if not path.exists():
        return web.Response(text=missing_msg, status=404)
    html = _cache_bust_html(path.read_text())
    return web.Response(text=html, content_type="text/html")


# ── HTTP API handlers (stateless) ─────────────────────────

async def handle_index(request):
    """Serve the main page."""
    return _serve_html(Path("frontend/index.html"),
                       "Frontend not found. Run from project root.")


async def handle_master(request):
    """Redirect /master to /sandbox (which now includes mastering)."""
    raise web.HTTPFound("/sandbox")


async def handle_sandbox(request):
    """Serve the sandbox page."""
    return _serve_html(Path("frontend/sandbox.html"),
                       "Sandbox page not found.")


async def handle_about(request):
    """Serve the about page."""
    return _serve_html(Path("frontend/about.html"),
                       "About page not found.")


async def handle_donate(request):
    """Serve the donate page."""
    return _serve_html(Path("frontend/donate.html"),
                       "Donate page not found.")


async def handle_contact(request):
    """Serve the contact page."""
    return _serve_html(Path("frontend/contact.html"),
                       "Contact page not found.")


async def handle_browse(request):
    """Browse markets by category."""
    import market.gamma as gamma_module
    from datetime import datetime, timezone
    tag_id = request.query.get("tag_id")
    sort = request.query.get("sort", "volume")
    limit = min(int(request.query.get("limit", "10")), 50)
    try:
        if tag_id == "live":
            markets = gamma_module.fetch_live_finance_markets()
        else:
            tag_id_int = int(tag_id) if tag_id else None
            markets = gamma_module.fetch_browse_markets(tag_id=tag_id_int, limit=limit, sort=sort)

        # Drop markets whose end_date has already passed
        now = datetime.now(timezone.utc)
        filtered = []
        for m in markets:
            end = m.get("end_date")
            if end:
                try:
                    end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
                    if end_dt < now:
                        continue
                except (ValueError, TypeError):
                    pass
            filtered.append(m)
        markets = filtered

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
    """Start market feed and DJ on server boot."""
    import market.gamma as gamma_module

    state.dj = AutonomousDJ(state.scorer, None, gamma_module, on_event=_on_dj_event)
    state.dj.on_market_ended = _on_market_ended

    def _on_resolution(msg):
        state.dj.on_market_resolved(msg)
        asyncio.ensure_future(_handle_resolution_for_sessions(msg))

    state.feed = MarketFeed(state.scorer, on_resolution=_on_resolution)
    state.dj.feed = state.feed

    # Re-discover tracks
    state.tracks = state._find_tracks()

    print("[SERVER] Starting market feed...", flush=True)
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
    global _static_hashes
    _static_hashes = _build_static_hashes()
    print(f"[SERVER] Cache-busted {len(_static_hashes)} static files.", flush=True)

    app = web.Application()
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # Main page
    app.router.add_get("/", handle_index)
    app.router.add_get("/master", handle_master)
    app.router.add_get("/sandbox", handle_sandbox)
    app.router.add_get("/about", handle_about)
    app.router.add_get("/donate", handle_donate)
    app.router.add_get("/contact", handle_contact)
    app.router.add_get("/robots.txt", lambda r: web.FileResponse("frontend/robots.txt"))
    app.router.add_get("/sitemap.xml", lambda r: web.FileResponse("frontend/sitemap.xml"))

    # WebSocket
    app.router.add_get("/ws", handle_ws)

    # Stateless API endpoints
    app.router.add_get("/api/browse", handle_browse)
    app.router.add_get("/api/categories", handle_categories)

    # Static files (frontend/)
    frontend_path = Path("frontend")
    if frontend_path.exists():
        app.router.add_static("/static/", path=str(frontend_path), name="static")

    # Audio samples (samples/) — served to Strudel's samples() loader
    samples_path = Path("samples")
    if samples_path.exists():
        app.router.add_static("/samples/", path=str(samples_path), name="samples")

    return app


if __name__ == "__main__":
    print("""
    +==========================================+
    |    DATA AS MUSIC — WEB SERVER            |
    |    http://localhost:8888                  |
    +==========================================+
    """, flush=True)
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8888, print=lambda msg: print(f"[SERVER] {msg}", flush=True))
