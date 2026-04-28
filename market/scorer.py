import time
import math
import statistics
from collections import defaultdict, deque
from config import (
    WEIGHT_PRICE_VELOCITY, WEIGHT_TRADE_RATE,
    WEIGHT_VOLUME, WEIGHT_SPREAD, MIN_TRADE_RATE,
    VELOCITY_MAX_MOVE
)


class MarketScorer:
    """
    Tracks real-time signals for each market.

    The mid price is the single source of truth for all price-derived
    signals. Raw mid samples are passed through a 3-sample rolling median
    before entering history, which removes single-tick book jitter while
    preserving step changes. All derivative signals (velocity, volatility,
    momentum, price_move, tone) read from this smoothed history.

    Sampling cadence is external: callers invoke `sample_mid(aid)` once per
    DATA_PUSH_INTERVAL for each market being watched.
    """

    # Spreads older than this (seconds) are considered stale and reset to default
    SPREAD_STALE_SECS = 30

    # Number of recent samples averaged for the smoothed-spread read.
    SPREAD_SMOOTH_WINDOW = 3

    # Number of raw mid samples in the rolling-median smoother.
    MID_SMOOTH_WINDOW = 3

    # Depth of the per-market mid price history (in samples). At 3s cadence,
    # 1300 samples ≈ 65 min — covers the 1hr lookback at the lowest
    # sensitivity (PRICE_DELTA_TICKS_MAX=1200) with a small safety margin.
    # Memory cost is trivial: a few thousand floats per watched market.
    MID_HISTORY_MAXLEN = 1300

    def __init__(self):
        # Latest top-of-book per market, updated as book events stream in.
        self._latest_bid    = {}
        self._latest_ask    = {}
        self._spread_updated = defaultdict(float)

        # Rolling median smoother: last N raw mid samples per market.
        self._raw_mid_samples = defaultdict(lambda: deque(maxlen=self.MID_SMOOTH_WINDOW))

        # Smoothed mid price history: market_id → deque of (timestamp, mid).
        # Populated by sample_mid() at the broadcast cadence, not on every
        # book event. Used by price_velocity and by the server for all
        # other price-derived signals.
        self.price_history  = defaultdict(lambda: deque(maxlen=self.MID_HISTORY_MAXLEN))

        # Recent spread values, sampled at the same cadence as price_history.
        self._spread_history = defaultdict(lambda: deque(maxlen=self.SPREAD_SMOOTH_WINDOW))

        # Trade events: market_id → deque of timestamps (for rate).
        self.trade_times    = defaultdict(lambda: deque(maxlen=500))

        # 24h volume from Gamma REST (static per fetch cycle)
        self.volumes        = defaultdict(float)

        # Adaptive trade rate: EMA of trades/min per market
        self._rate_ema      = defaultdict(float)    # smoothed baseline
        self._rate_last_t   = defaultdict(float)    # last EMA update time

    # ── Feed methods (called by WebSocket handler) ────────

    def on_trade(self, market_id: str, size: float = 0.0, price: float = 0.0):
        self.trade_times[market_id].append(time.time())

    def on_best_bid_ask(self, market_id: str, bid: float, ask: float):
        self._latest_bid[market_id] = bid
        self._latest_ask[market_id] = ask
        self._spread_updated[market_id] = time.time()

    def set_volume(self, market_id: str, volume: float):
        self.volumes[market_id] = volume

    # ── Mid sampling ──────────────────────────────────────

    def sample_mid(self, market_id: str) -> float | None:
        """Take one sample of the current mid into the smoothed history.

        Must be called at a regular cadence (once per DATA_PUSH_INTERVAL per
        watched market) from the broadcast loop. Returns the newly stored
        smoothed value, or None if we have no bid/ask yet.

        The smoother is a rolling median of the last MID_SMOOTH_WINDOW raw
        samples. A single outlier (e.g., a transient cancel-driven mid jump)
        can't pass through until it persists for at least two samples, but a
        real step change appears almost immediately — median of [a, a, b] is
        still a on the first new b, but median of [a, b, b] is b on the
        second.

        Also records the current raw spread into _spread_history so spread
        reads are smoothed over the same cadence.
        """
        bid = self._latest_bid.get(market_id)
        ask = self._latest_ask.get(market_id)
        if bid is None or ask is None:
            return None
        raw_mid = (bid + ask) / 2.0
        raw_spread = max(0.0, ask - bid)

        samples = self._raw_mid_samples[market_id]
        samples.append(raw_mid)
        smoothed_mid = statistics.median(samples)

        self.price_history[market_id].append((time.time(), smoothed_mid))
        self._spread_history[market_id].append(raw_spread)
        return smoothed_mid

    # ── Read helpers ──────────────────────────────────────

    def get_smoothed_mid(self, market_id: str) -> float | None:
        """Latest smoothed mid, or None if no samples yet."""
        hist = self.price_history.get(market_id)
        if not hist:
            return None
        return hist[-1][1]

    def get_recent_mids(self, market_id: str, window_seconds: float) -> list[tuple[float, float]]:
        """Return (t, mid) entries from the last `window_seconds`."""
        hist = self.price_history.get(market_id)
        if not hist:
            return []
        cutoff = time.time() - window_seconds
        return [(t, p) for t, p in hist if t >= cutoff]

    def get_smoothed_spread(self, market_id: str) -> float:
        """Mean spread over the last SPREAD_SMOOTH_WINDOW samples. Returns
        a default wide spread (0.2) when stale or missing, matching the
        SPREAD_STALE_SECS behaviour in spread_score."""
        updated = self._spread_updated.get(market_id, 0)
        if updated and time.time() - updated > self.SPREAD_STALE_SECS:
            return 0.2  # stale — treat as moderately wide
        hist = self._spread_history.get(market_id)
        if not hist:
            return 0.2
        return sum(hist) / len(hist)

    # ── Scoring ───────────────────────────────────────────

    def price_velocity(self, market_id: str, window: int = 300) -> float:
        """Price excursion (max-min) over the last `window` seconds,
        normalized so VELOCITY_MAX_MOVE = 1.0.

        This is max-min range rather than endpoint subtraction: a market
        that swung up 5¢ and back down reads 0.5 (5¢ range), not 0. That
        distinguishes it from price_move (which is directional) and gives
        a stable magnitude signal that doesn't cancel to zero on chop.
        """
        recent = self.get_recent_mids(market_id, window)
        if len(recent) < 2:
            return 0.0
        prices = [p for _, p in recent]
        return min(1.0, (max(prices) - min(prices)) / VELOCITY_MAX_MOVE)

    def _raw_trade_rate(self, market_id: str, window: int = 60) -> float:
        """Raw trades per minute over last `window` seconds."""
        now = time.time()
        recent = [t for t in self.trade_times[market_id] if now - t < window]
        return len(recent) * (60.0 / window)

    def trade_rate(self, market_id: str, window: int = 60) -> float:
        """Adaptive trade rate 0–1. Uses log curve relative to a rolling
        baseline so it self-calibrates to any market's activity level.

        - EMA tracks what 'normal' looks like (slow-moving baseline, ~5 min half-life)
        - Current rate is compared to baseline: ratio > 1 = busier than usual
        - Log curve compresses the ratio so huge spikes don't just pin at 1.0
        - Result: 0 = no trades, ~0.25 = baseline activity, 0.5 = 3x spike, 0.75 = 7x
        """
        raw = self._raw_trade_rate(market_id, window)

        # Update EMA baseline (~5 min half-life: alpha ≈ 0.01 at 3s intervals).
        # Always update when dt >= 2s so the baseline decays toward 0 during
        # silence instead of freezing at its last value.
        now = time.time()
        dt = now - self._rate_last_t[market_id]
        if self._rate_last_t[market_id] == 0:
            # First call — seed baseline with current rate
            self._rate_ema[market_id] = max(raw, 0.5)
            self._rate_last_t[market_id] = now
        elif dt >= 2.0:
            # Use larger alpha when gap is long so EMA catches up after silence
            alpha = min(1.0, dt / 300.0)  # ~5 min to converge
            self._rate_ema[market_id] += alpha * (raw - self._rate_ema[market_id])
            self._rate_ema[market_id] = max(self._rate_ema[market_id], 0.5)  # floor
            self._rate_last_t[market_id] = now

        baseline = self._rate_ema[market_id]
        # Ratio: 1.0 = at baseline, 2.0 = double, 0.5 = half
        ratio = raw / baseline if baseline > 0 else 0.0
        # Log curve: log2(ratio+1) maps 0→0, 1→1, 3→2, 7→3
        # Normalise so ratio=1 (baseline) → 0.25, ratio=3 → 0.5, ratio=7 → 0.75
        score = math.log2(ratio + 1.0) / 4.0
        return max(0.0, min(1.0, score))

    def spread_score(self, market_id: str) -> float:
        """Tight spread = active market. Returns 0–1 (higher = tighter).
        Uses smoothed spread over the last few samples so a single top-of-
        book cancel doesn't jerk the reading. Returns 0 if spread data is
        stale (no update in SPREAD_STALE_SECS)."""
        updated = self._spread_updated.get(market_id, 0)
        if updated and time.time() - updated > self.SPREAD_STALE_SECS:
            return 0.0  # stale — treat as wide spread
        smoothed = self.get_smoothed_spread(market_id)
        return max(0.0, 1.0 - (smoothed / 0.3))   # 0.3 spread = 0 score

    def volume_score(self, market_id: str, max_volume: float = 1_000_000) -> float:
        """Normalised 24h volume. Returns 0–1."""
        return min(1.0, self.volumes.get(market_id, 0) / max_volume)

    def heat(self, market_id: str) -> float:
        """Composite heat score 0.0–1.0. Uses a fixed 5-min price_velocity
        window so heat reflects per-market activity independent of any
        client's sensitivity setting."""
        # Dead market floor check — fewer than MIN_TRADE_RATE raw trades/min
        if self._raw_trade_rate(market_id) < MIN_TRADE_RATE:
            return 0.0

        return (
            self.price_velocity(market_id) * WEIGHT_PRICE_VELOCITY +
            self.trade_rate(market_id)     * WEIGHT_TRADE_RATE     +
            self.volume_score(market_id)   * WEIGHT_VOLUME         +
            self.spread_score(market_id)   * WEIGHT_SPREAD
        )

    def rank(self, market_ids: list[str]) -> list[tuple[str, float]]:
        """Return markets sorted by heat, highest first."""
        scored = [(mid, self.heat(mid)) for mid in market_ids]
        return sorted(scored, key=lambda x: x[1], reverse=True)
