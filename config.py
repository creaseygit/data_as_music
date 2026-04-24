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

# ── Price movement (leaky integrator) ─────────────────────
# price_move is a signed leaky integrator of per-tick mid deltas. Direction
# + magnitude + natural decay to zero when price is flat — see
# docs/development/signal-primitives.md for the full rationale.
#
# Sensitivity maps to the integrator's half-life: at sens=1.0 it decays
# over PRICE_MOVE_HL_MIN seconds (reacts to every flicker); at sens=0.0 it
# decays over PRICE_MOVE_HL_MAX seconds (news-horizon — only sustained or
# massive moves register).
PRICE_MOVE_HL_MIN      = 15.0      # seconds, scalper preset (sens=1.0)
PRICE_MOVE_HL_MAX      = 3600.0    # seconds, event/news preset (sens=0.0)
PRICE_MOVE_GAIN        = 20.0      # maps Δmid into pm_v units; tune by ear
VELOCITY_MAX_MOVE      = 0.10      # 10¢ move in velocity window = 1.0 (absolute, not percentage)

# Legacy: kept for back-compat with the old windowed-price_move code path,
# which is being replaced by the leaky integrator. Safe to remove once
# signal-primitives Phase 5 lands.
PRICE_MOVE_MAX_30S     = 0.03      # anchor: a 3¢ move in 30s saturates magnitude

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
