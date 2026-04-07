import time
import math
from collections import defaultdict, deque
import statistics
from config import (
    WEIGHT_PRICE_VELOCITY, WEIGHT_TRADE_RATE,
    WEIGHT_VOLUME, WEIGHT_SPREAD, MIN_TRADE_RATE,
    VELOCITY_MAX_MOVE
)


class MarketScorer:
    """
    Tracks real-time signals for each market and produces a
    normalised heat score between 0.0 and 1.0.
    """

    # Spreads older than this (seconds) are considered stale and reset to default
    SPREAD_STALE_SECS = 30

    def __init__(self):
        # price history: market_id → deque of (timestamp, price)
        self.price_history  = defaultdict(lambda: deque(maxlen=20))
        # trade events: market_id → deque of timestamps
        self.trade_times    = defaultdict(lambda: deque(maxlen=500))
        # best bid/ask: market_id → (bid, ask)
        self.spreads        = defaultdict(lambda: (0.4, 0.6))
        # timestamp of last spread update per market
        self._spread_updated = defaultdict(float)
        # 24h volume from Gamma REST (static per fetch cycle)
        self.volumes        = defaultdict(float)
        # Adaptive trade rate: EMA of trades/min per market
        self._rate_ema      = defaultdict(float)    # smoothed baseline
        self._rate_last_t   = defaultdict(float)    # last EMA update time
        # Trade sizes: market_id → deque of (timestamp, size)
        self.trade_sizes    = defaultdict(lambda: deque(maxlen=200))
        # Whale trades: market_id → deque of (timestamp, size, price, magnitude)
        self.whale_trades   = defaultdict(lambda: deque(maxlen=20))

    # ── Feed methods (called by WebSocket handler) ────────

    def on_price_change(self, market_id: str, price: float):
        self.price_history[market_id].append((time.time(), price))

    def on_trade(self, market_id: str, size: float = 0.0, price: float = 0.0):
        now = time.time()
        self.trade_times[market_id].append(now)
        if size > 0:
            self.trade_sizes[market_id].append((now, size))
            self._check_whale(market_id, size, price, now)

    def on_best_bid_ask(self, market_id: str, bid: float, ask: float):
        self.spreads[market_id] = (bid, ask)
        self._spread_updated[market_id] = time.time()

    def set_volume(self, market_id: str, volume: float):
        self.volumes[market_id] = volume

    # ── Scoring ───────────────────────────────────────────

    def price_velocity(self, market_id: str, window: int = 300) -> float:
        """Rate of price change over last `window` seconds. Returns 0–1."""
        history = list(self.price_history[market_id])
        now = time.time()
        recent = [(t, p) for t, p in history if now - t < window]
        if len(recent) < 2:
            return 0.0
        prices = [p for _, p in recent]
        return min(1.0, abs(prices[-1] - prices[0]) / VELOCITY_MAX_MOVE)

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
        Returns 0 if spread data is stale (no update in SPREAD_STALE_SECS)."""
        updated = self._spread_updated.get(market_id, 0)
        if updated and time.time() - updated > self.SPREAD_STALE_SECS:
            return 0.0  # stale — treat as wide spread
        bid, ask = self.spreads[market_id]
        spread = ask - bid
        return max(0.0, 1.0 - (spread / 0.3))   # 0.3 spread = 0 score

    def volume_score(self, market_id: str, max_volume: float = 1_000_000) -> float:
        """Normalised 24h volume. Returns 0–1."""
        return min(1.0, self.volumes.get(market_id, 0) / max_volume)

    def _check_whale(self, market_id: str, size: float, price: float, now: float):
        """Detect outlier trade sizes (>= 3x rolling median)."""
        sizes = self.trade_sizes[market_id]
        if len(sizes) < 10:
            return  # not enough history to judge
        recent_sizes = [s for _, s in sizes]
        median_size = statistics.median(recent_sizes)
        if median_size <= 0:
            return
        ratio = size / median_size
        if ratio >= 3.0:
            # Normalize magnitude: 3x = 0.33, 6x = 0.67, 9x+ = 1.0
            magnitude = min(1.0, ratio / 9.0)
            self.whale_trades[market_id].append((now, size, price, magnitude))

    def get_whale_trades(self, market_id: str, since: float = 0.0) -> list[dict]:
        """Return whale trades since a given timestamp (does not clear —
        each client tracks its own last-check timestamp)."""
        trades = self.whale_trades[market_id]
        result = []
        for t, size, price, magnitude in trades:
            if t <= since:
                continue
            result.append({
                "timestamp": t,
                "size": size,
                "price": price,
                "magnitude": magnitude,
                "direction": 1 if price > 0.5 else -1,
            })
        return result

    def heat(self, market_id: str) -> float:
        """Composite heat score 0.0–1.0."""
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
