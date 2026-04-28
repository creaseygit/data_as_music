"""
Per-client session management for multi-user WebSocket connections.

Each browser client gets a ClientSession with independent market selection,
sensitivity, and event detection state. SessionManager coordinates shared
market WebSocket subscriptions via reference counting.

Note: the price time series used for volatility / momentum / price_move
lives on the scorer (shared across sessions watching the same market).
The session only keeps per-client derived state — EMAs, hysteresis, event
baselines — since those depend on the session's sensitivity setting.
"""
import uuid
from aiohttp import web


class ClientSession:
    """State for a single connected browser client."""

    def __init__(self, ws: web.WebSocketResponse):
        self.client_id = uuid.uuid4().hex[:12]
        self.ws = ws
        self.market_slug: str | None = None
        self.asset_id: str | None = None
        self.market: dict | None = None       # full market dict
        self.track: str = "oracle"
        self.sensitivity: float = 0.5

        # Per-client event detection state
        self._prev_heat: float = 0.0
        self._prev_price: float = 0.5
        self._prev_asset: str | None = None
        self._current_tone: int = 1           # 1=bullish, 0=bearish
        self._prev_price_move: float = 0.0    # legacy, unused after signal-primitives Phase 1

        # price_move leaky integrator state. pm_v is the signed output in
        # [-1, 1]; _prev_smoothed_mid holds the last scorer mid so each tick
        # can take a signed Δmid. Reset on market rotation.
        self.pm_v: float = 0.0
        self._prev_smoothed_mid: float | None = None

        # Per-tick gate for the `price_moving` boolean. Tracks the last
        # smoothed mid seen in the price_moving check so we can decide
        # whether the price actually ticked this broadcast cycle.
        self._prev_gate_mid: float | None = None

        # Dual-EMA state for momentum (MACD-inspired). Updated per tick
        # from the scorer's latest smoothed mid.
        self._ema_fast: float = 0.5
        self._ema_slow: float = 0.5

        # Tick-based warmup: counts broadcast ticks since the current
        # market was rotated in. Used by the warmup fade and by
        # price_delta_cents to skip the median-smoother flush window.
        self._ticks_since_rotation: int = 0

        # Max sensitivity-window entries for the current market, or None
        # for markets with no short-lifetime cap. Set on pin from the
        # market's remaining lifetime so a 5-min market never demands an
        # 8-min window.
        self._market_window_cap: int | None = None

        # Logging breadcrumbs — track values we've already announced so
        # the [SENS]/[BAND]/[HIST] logs only fire on change. None for
        # _prev_logged_sens means "first broadcast for this session, do
        # not fire a SENS-changed log yet".
        self._prev_logged_sens: float | None = None
        self._prev_logged_band: int = 0
        self._history_milestone_logged: bool = False

    def reset_event_state(self):
        """Reset event baselines (e.g. after market switch)."""
        self._prev_heat = 0.0
        self._prev_price = 0.5
        self._prev_asset = None
        self._current_tone = 1
        self._prev_price_move = 0.0
        self.pm_v = 0.0
        self._prev_smoothed_mid = None
        self._prev_gate_mid = None
        self._ema_fast = 0.5
        self._ema_slow = 0.5
        self._ticks_since_rotation = 0
        self._market_window_cap = None
        # Reset per-market log state so [BAND] and [HIST] re-emit their
        # first events for the new market. Sensitivity is per-session,
        # not per-market — leave _prev_logged_sens alone.
        self._prev_logged_band = 0
        self._history_milestone_logged = False


class SessionManager:
    """Manages all connected client sessions and shared market subscriptions."""

    def __init__(self):
        self.sessions: dict[str, ClientSession] = {}
        # Reference counting: asset_id → set of client_ids watching it
        self._market_watchers: dict[str, set[str]] = {}

    def add(self, session: ClientSession):
        self.sessions[session.client_id] = session

    def remove(self, client_id: str) -> ClientSession | None:
        session = self.sessions.pop(client_id, None)
        if session and session.asset_id:
            self._unwatch(client_id, session.asset_id)
        return session

    def get(self, client_id: str) -> ClientSession | None:
        return self.sessions.get(client_id)

    def watch_market(self, client_id: str, asset_id: str) -> bool:
        """Register a client as watching an asset. Returns True if this is
        the first watcher (caller should subscribe to market feed)."""
        first = asset_id not in self._market_watchers or len(self._market_watchers[asset_id]) == 0
        if asset_id not in self._market_watchers:
            self._market_watchers[asset_id] = set()
        self._market_watchers[asset_id].add(client_id)
        return first

    def _unwatch(self, client_id: str, asset_id: str) -> bool:
        """Unregister a client. Returns True if no more watchers remain
        (caller could unsubscribe from market feed)."""
        watchers = self._market_watchers.get(asset_id)
        if watchers:
            watchers.discard(client_id)
            if not watchers:
                del self._market_watchers[asset_id]
                return True
        return False

    def unwatch_market(self, client_id: str, asset_id: str) -> bool:
        """Public unwatch. Returns True if no more watchers remain."""
        return self._unwatch(client_id, asset_id)

    @property
    def active_count(self) -> int:
        return len(self.sessions)

    def all_sessions(self):
        """Iterate over all sessions (snapshot to avoid mutation during iteration)."""
        return list(self.sessions.values())
