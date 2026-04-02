"""
Per-client session management for multi-user WebSocket connections.

Each browser client gets a ClientSession with independent market selection,
sensitivity, and event detection state. SessionManager coordinates shared
market WebSocket subscriptions via reference counting.
"""
import time
import uuid
from collections import deque
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

        # Per-client event detection state (mirrors old AppState fields)
        self._prev_heat: float = 0.0
        self._prev_price: float = 0.5
        self._prev_asset: str | None = None
        self._current_tone: int = 1           # 1=bullish, 0=bearish

        # Rolling price buffer — 160 entries = 8 min at 3s intervals.
        # Supports sensitivity-scaled windows for momentum & volatility.
        self._price_history: deque[float] = deque(maxlen=160)
        self._prev_price_move: float = 0.0
        self._drift_anchor: float = 0.5    # price at last price_move emission

        # Dual-EMA state for momentum (MACD-inspired)
        self._ema_fast: float = 0.5
        self._ema_slow: float = 0.5

        # Warmup: timestamp when current market was selected
        self._market_start_time: float = 0.0

    def reset_event_state(self):
        """Reset event baselines (e.g. after market switch)."""
        self._prev_heat = 0.0
        self._prev_price = 0.5
        self._prev_asset = None
        self._current_tone = 1
        self._price_history.clear()
        self._prev_price_move = 0.0
        self._drift_anchor = 0.5
        self._ema_fast = 0.5
        self._ema_slow = 0.5
        self._market_start_time = time.monotonic()


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
