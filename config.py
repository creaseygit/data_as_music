# ── Market API ───────────────────────────────────────────
GAMMA_API      = "https://gamma-api.polymarket.com"
CLOB_REST      = "https://clob.polymarket.com"
CLOB_WS        = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

# How often to re-score and potentially re-mix (seconds)
RESCORE_INTERVAL   = 30
MARKET_FETCH_LIMIT = 50          # pull top N active markets to score from

# ── Scoring weights ──────────────────────────────────────
WEIGHT_PRICE_VELOCITY = 0.35
WEIGHT_TRADE_RATE     = 0.40
WEIGHT_VOLUME         = 0.15
WEIGHT_SPREAD         = 0.10

# Minimum trade events per minute to be considered "alive"
MIN_TRADE_RATE     = 2

# ── Sensitivity ─────────────────────────────────────────
DEFAULT_SENSITIVITY    = 0.5       # 0.0 (least reactive) → 1.0 (most reactive)
EVENT_HEAT_THRESHOLD   = 0.15      # heat delta to fire :event_spike
EVENT_PRICE_THRESHOLD  = 0.03      # price delta (¢) to fire :event_price_move

# ── Rolling price movement ─────────────────────────────────
# price_move uses a sensitivity-scaled window (same curve as momentum/
# volatility: 45s at max sens → 8min at min sens). Max magnitude scales
# with √window (random-walk growth) so "saturated" means "a big move
# for this timescale" at any sensitivity:
#   45s  window →  ~3.7¢   (scalper move)
#   2.5min       →  ~7¢    (day-trader move)
#   8min         →  ~12¢   (sustained swing trend)
# The curve is anchored at PRICE_MOVE_MAX_30S (a 3¢ move in 30s = 1.0).
PRICE_MOVE_MAX_30S     = 0.03      # anchor: a 3¢ move in 30s saturates magnitude
VELOCITY_MAX_MOVE      = 0.10      # 10¢ move in velocity window = 1.0 (absolute, not percentage)

# ── WebSocket (server → browser) ────────────────────────
WS_PING_INTERVAL = 30           # seconds, keep-alive for CloudFlare's 100s idle timeout
MAX_CLIENTS      = 200          # safety limit on concurrent WebSocket connections
DATA_PUSH_INTERVAL = 3.0        # seconds between market data pushes to clients

# ── Warmup (intro fade-in on market switch) ─────────────
# Short smoothstep fade that suppresses first-tick noise and prevents
# audio pops on market switch. Decoupled from sensitivity-window fill:
# the backfill seeds the scorer's price history on pin, so window-based
# signals reach full magnitude immediately and this fade is purely an
# audio-domain ease-in, not a data-readiness gate.
WARMUP_DURATION    = 4.0        # seconds

# ── Browse categories ──────────────────────────────────
# Tag IDs for the Browse tabs in the web UI
BROWSE_CATEGORIES = [
    {"label": "Trending",     "tag_id": None,   "sort": "volume"},
    {"label": "Crypto Live",  "tag_id": "live"},
    {"label": "Politics",     "tag_id": 2},
    {"label": "Sports",       "tag_id": 100639},
    {"label": "Crypto",       "tag_id": 21},
    {"label": "Finance",      "tag_id": 120},
    {"label": "Culture",      "tag_id": 596},
    {"label": "Geopolitics",  "tag_id": 100265},
    {"label": "Tech",         "tag_id": 1401},
    {"label": "Closing Soon", "tag_id": None,   "sort": "closing"},
]
