# ── Polymarket ───────────────────────────────────────────
GAMMA_API      = "https://gamma-api.polymarket.com"
CLOB_WS        = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

# How often to re-score and potentially re-mix (seconds)
RESCORE_INTERVAL   = 30
MARKET_FETCH_LIMIT = 50          # pull top N active markets to score from

# ── Mixer ────────────────────────────────────────────────
MAX_ACTIVE_LAYERS  = 5           # simultaneous market→instrument mappings
MIN_ACTIVE_LAYERS  = 2           # floor — always keep something playing
SWAP_THRESHOLD     = 0.25        # score delta before triggering a swap
FADE_BARS          = 8           # crossfade duration in musical bars

# ── Scoring weights ──────────────────────────────────────
WEIGHT_PRICE_VELOCITY = 0.35
WEIGHT_TRADE_RATE     = 0.40
WEIGHT_VOLUME         = 0.15
WEIGHT_SPREAD         = 0.10

# Minimum trade events per minute to be considered "alive"
MIN_TRADE_RATE     = 2

# ── OSC ──────────────────────────────────────────────────
OSC_IP   = "127.0.0.1"
OSC_PORT = 4560

# ── Ambient fallback ─────────────────────────────────────
# Triggered when no markets exceed MIN_TRADE_RATE
AMBIENT_MODE_THRESHOLD = 1       # active markets below this → go ambient

# ── Request mode (Phase 2) ───────────────────────────────
# Allow a specific market to be pinned as the lead layer
PINNED_MARKET_SLUG = None        # e.g. "will-trump-veto-the-bill"

# ── Browse categories ──────────────────────────────────
# Polymarket tag_ids for the Browse tabs in the web UI
BROWSE_CATEGORIES = [
    {"label": "Trending",     "tag_id": None,   "sort": "volume"},
    {"label": "Politics",     "tag_id": 2},
    {"label": "Sports",       "tag_id": 100639},
    {"label": "Crypto",       "tag_id": 21},
    {"label": "Finance",      "tag_id": 120},
    {"label": "Culture",      "tag_id": 596},
    {"label": "Geopolitics",  "tag_id": 100265},
    {"label": "Tech",         "tag_id": 1401},
    {"label": "Closing Soon", "tag_id": None,   "sort": "closing"},
]
