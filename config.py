# ── Market API ───────────────────────────────────────────
GAMMA_API      = "https://gamma-api.polymarket.com"
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
PRICE_MOVE_WINDOW      = 30        # seconds — look-back for price_move signal
PRICE_MOVE_MAX         = 0.03      # 3¢ move in window = magnitude 1.0
DRIFT_THRESHOLD        = 0.05      # 5¢ cumulative creep since last detected move → emit price_move

# ── WebSocket (server → browser) ────────────────────────
WS_PING_INTERVAL = 30           # seconds, keep-alive for CloudFlare's 100s idle timeout
MAX_CLIENTS      = 200          # safety limit on concurrent WebSocket connections
DATA_PUSH_INTERVAL = 3.0        # seconds between market data pushes to clients

# ── Warmup (intro fade-in on market switch) ─────────────
WARMUP_DURATION    = 18.0       # seconds — activity signals tween from calm to real data

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
