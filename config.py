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
# Tick-based, not time-based: the binding constraint is the rolling-median
# smoother flushing backfilled samples. With MID_SMOOTH_WINDOW=3, three
# live ticks must pass before smoothed_mid is fully decoupled from backfill,
# and any earlier "delta" is a statistical artifact of that flush, not a
# real price move. WARMUP_TICKS=4 gives the smoother one tick of headroom.
#
# During warmup the server hard-zeroes change-based signals (price_delta_cents,
# price_move) and freezes per-session integrator state so post-warmup
# baselines are clean. Continuous signals (heat, momentum, volatility)
# are smoothstep-faded over the same window for a non-jarring intro.
WARMUP_TICKS       = 4

# ── Price delta (cents-based change signal) ─────────────
# price_delta_cents: signed cents over a short fixed lookback on the
# scorer's smoothed mid. Direction = sign, magnitude = how much the
# price moved.
DELTA_LOOKBACK_TICKS = 10       # fixed ~30s lookback (10 × 3s cadence)

# ── Magnitude bands (deadzone + ramps) ──────────────────
# price_delta_band collapses the signed cents move into one of seven cells:
#   -3 / -2 / -1 / 0 / +1 / +2 / +3   (negative=down, 0=silence, positive=up)
# Three thresholds separate band boundaries (in cents). The deadzone is
# everything below the LOW threshold; LOW–MED–HIGH are the three rising
# ramps either side. At sens=0.5 the thresholds are the defaults below;
# both sides scale together by a sensitivity factor (10× wider at sens=0.0,
# 10× tighter at sens=1.0) so the band shape stays self-similar — the
# slider simply tells the music what counts as "small" vs "huge".
PRICE_DELTA_BAND_LOW   = 0.5    # cents — start of band 1 (deadzone ends here)
PRICE_DELTA_BAND_MED   = 2.0    # cents — start of band 2
PRICE_DELTA_BAND_HIGH  = 5.0    # cents — start of band 3

# ── Noise estimation (σ) ────────────────────────────────
# The scorer maintains a rolling window of tick-to-tick smoothed mid
# deltas and exposes their stddev as σ. Currently informational only
# (included in the data payload for tracks/debugging).
SIGMA_WINDOW       = 60     # samples (~3 min) for stable estimate
SIGMA_MIN_SAMPLES  = 10     # minimum ticks before trusting σ
SIGMA_FLOOR_CENTS  = 0.01   # floor when market is perfectly flat (avoids ÷0)

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
