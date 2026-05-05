# Data-Music Interface

The server pushes **normalized market data** to each connected browser client via WebSocket every 3 seconds. Tracks receive data via their `update(data)` method and decide their own musical interpretation. **The server does not prescribe musical behaviour.**

All price-derived signals share a single source of truth: a smoothed mid-price time series held in the scorer. Raw mids are passed through a 3-sample rolling median before entering history, so a single-tick order-book twitch never shows up in the downstream signals. The same cleaned samples feed velocity, volatility, momentum, price_move, and tone.

## Data Values (pushed every 3s via WebSocket)

| Name          | Range      | Source                                                              |
| ------------- | ---------- | ------------------------------------------------------------------- |
| `heat`        | 0.0 – 1.0  | Composite market activity (velocity·0.35 + trade_rate·0.40 + volume·0.15 + spread·0.10). Uses the scorer's fixed 5-min velocity window internally, so heat reflects per-market activity independent of the client's sensitivity. Power-curve shaped by sensitivity before send. |
| `price`       | 0.0 – 1.0  | Smoothed WebSocket bid/ask midpoint; falls back to the Gamma REST `outcome_prices` value while book data hasn't arrived yet. |
| `price_delta_cents` | signed, in cents | **Raw rolling magnitude of recent movement.** Signed delta in cents, `(smoothed_mid_now − smoothed_mid_10_ticks_ago) · 100` over a fixed ~30s lookback. Lookback is clamped so it never reaches past the warmup boundary. Use this for gain-saturation curves (loudness within a band scales with raw move size). **Do not use as a silence gate** — use `price_delta_band` for "which band am I in?" decisions. |
| `price_delta_band` | int -3..+3 | **Server-decided magnitude band.** Single source of truth for "which gauge cell / which phrase length". Sign = direction (negative = down, positive = up); magnitude = phrase size (1 = small, 2 = medium, 3 = large). 0 = silence (move sits inside the sensitivity-scaled deadzone). Thresholds scale with sensitivity: at sens=0.5 the bands sit at 0.5 / 2 / 5 ¢; at sens=0 they widen ×10 (5 / 20 / 50 ¢); at sens=1 they tighten ×10 (0.05 / 0.2 / 0.5 ¢). Read this directly so the audio always matches the visual delta gauge. |
| `price_moving` | bool     | **Canonical "is the price ticking right now" gate.** True iff the smoothed mid changed by ≥0.05¢ since the previous broadcast tick. False during warmup and on flat markets. Pair with `price_delta_band`: gate on `price_moving`, pick the phrase from `price_delta_band`. |
| `price_move`  | -1.0 – 1.0 | Signed leaky integrator on per-tick mid deltas. Same direction as `price_delta_cents` but unitless magnitude with natural decay-to-zero half-life (sensitivity-scaled). Older signal; new tracks should prefer `price_delta_cents` for change-driven musical gestures. |
| `momentum`    | -1.0 – 1.0 | Signed trend direction (dual-EMA on smoothed mid, MACD-inspired). Fast EMA period = window/3, slow = window. Normalized so ±5¢ EMA divergence → ±1.0. |
| `velocity`    | 0.0 – 1.0  | Price excursion magnitude over the sensitivity-scaled window, computed as `(max − min) / 0.10`. Unsigned. Reads `(max − min)` rather than endpoint subtraction so a market that swung up 5¢ and came back reads 0.5, not 0. |
| `trade_rate`  | 0.0 – 1.0  | Trades per minute, compared against a 5-min EMA baseline. Log-compressed: ratio=1 (baseline) → 0.25, ratio=3 → 0.5, ratio=7 → 0.75. Power-curve shaped by sensitivity. |
| `spread`      | 0.0 – 1.0  | Smoothed bid-ask tightness. Raw spread is averaged over the last 3 samples before normalizing (0.3¢ wide → 0, 0¢ → 1). Power-curve shaped by sensitivity. Stale-gated: returns 0 when no book update in 30s. |
| `volatility`  | 0.0 – 1.0  | Stddev of smoothed mids over the sensitivity-scaled window, normalized to 3¢ stddev = 1.0. Same Bollinger-band-width idea; smoother input means it reports real oscillation, not book jitter. |
| `tone`        | 0 or 1     | 1 = major (smoothed price > 0.55), 0 = minor (smoothed price < 0.45), with hysteresis. Inherits the 3-sample median smoothing, so single-tick crossings don't flip tone. |
| `sensitivity` | 0.0 – 1.0  | Client's sensitivity setting. Included in the payload so tracks can inspect it. |
| `sigma`       | float (¢) or null | Per-tick noise floor for the current market (stddev of recent tick-to-tick mid changes, in cents). `null` during calibration (~30s of live data). Tracks can use this to calibrate gain curves relative to the market's actual noise. |
| `window_seconds` | float (s) | Target window for the sensitivity-scaled signals (45s at max sens → 480s at min). For UI visualisation. |
| `window_fill`    | 0.0 – 1.0 | Fraction of the target window actually backed by buffered history. Grows from 0 to 1 over up to 8 min after a market switch. |

## Smoothing and lag

Every price-derived signal reads from the scorer's smoothed mid history. Smoothing happens once, at ingest:

1. WebSocket book events update the current top-of-book bid/ask.
2. Once per broadcast tick (every 3s) the scorer samples `(bid + ask) / 2` and pushes it through a 3-sample rolling median.
3. The median-of-3 output is appended to the per-market price history with a timestamp.

A transient cancel or partial-fill that moves the mid by 1–2¢ for one sample is rejected entirely — median of `[0.52, 0.52, 0.57]` is `0.52`. A real step change takes ~1 extra sample to confirm (median of `[0.52, 0.56, 0.56]` is `0.56`), which is the worst-case smoothing lag.

| Source of lag | Lag |
| --- | --- |
| Rolling-median smoother at ingest | 0–6s (1 extra sample to confirm a step) |
| Spread 3-sample mean | +0–6s on top of the above |
| Trade rate 60s count + 5-min EMA baseline | ~60s (by design — that's what "rate" measures) |
| Window-scaled signals (price_move, velocity, volatility, momentum) | the window itself is the analysis timescale, not lag |

Total noise-removal lag on any signal is under 9s, even at max sensitivity.

## How Sensitivity Works

Sensitivity is a single user-facing **reactivity** slider (0–100%) that controls everything price-driven on the server. The user sees one knob; under the hood it scales four things together so the music's response stays coherent at every setting:

### 1. Band thresholds (deadzone + ramps)

`price_delta_band` is the server-decided cell index that drives melody phrase length (Weather Vane / Digging / Late Night) and sample selection (So Over, So Back). The thresholds between cells scale with sensitivity:

| Sensitivity | LOW threshold | MED threshold | HIGH threshold | Feel                          |
| ----------- | ------------- | ------------- | -------------- | ----------------------------- |
| 1.0 (max)   | 0.05¢         | 0.2¢          | 0.5¢           | Snappy — every wiggle fires   |
| 0.5 (default) | 0.5¢        | 2¢            | 5¢             | Balanced                      |
| 0.0 (min)   | 5¢            | 20¢           | 50¢            | Only big moves register       |

Both the deadzone (silence below LOW) and the ramps stretch together by the same factor (`10^(1 − 2·sensitivity)`), so the band shape stays self-similar — the slider just tells the music what counts as "small" vs "huge". Dynamic range within the bands (small/med/large phrases) is preserved at every sensitivity.

### 2. Lookback window

`price_delta_cents` is computed over a **fixed 10-tick (~30s) lookback**. This is short enough to respond to any market (including 5-minute crypto rolling contracts) and long enough to capture meaningful movement.

The leaky integrator (`price_move` half-life) and the window-family signals (`velocity` / `volatility` / `momentum`) still use sensitivity-scaled windows for their analysis timescale.

### 3. Power-curve signals — amplitude

`heat`, `trade_rate`, and `spread` are transformed by a power curve `value^exp` where `exp = 4^(1 − 2·sensitivity)`:

- At 50% (default): linear, values unchanged
- At 100%: small values inflated (drums get busy on small heat blips)
- At 0%: small values crushed (drums stay calm unless there's real activity)

### 4. Event thresholds

`spike` and `price_step` event firing thresholds scale by `√(half_life / default)`, so at high sensitivity small moves trigger events and at low sensitivity only large jumps do.

### Unaffected signals

`price` and `tone` are never affected by sensitivity.

## Event Triggers (separate WebSocket messages)

| Event         | Fields                              | Condition                         |
| ------------- | ----------------------------------- | --------------------------------- |
| `spike`       | `magnitude: 0.0–1.0`               | Heat delta exceeds threshold (scales with half-life) |
| `price_step`  | `direction: 1\|-1`, `magnitude: 0.0–1.0` | Per-tick raw price delta exceeds threshold (scales with half-life). Distinct from the continuous `price_move` signal. |
| `resolved`    | `result: 1\|-1`                     | Market resolved (1=Yes won, -1=No won) |

Event **thresholds** are sensitivity-scaled (high sensitivity fires on smaller moves). Event **magnitudes** are raw — they tell the track how big the event actually was, so musicians can respond proportionally.

Events are **suppressed for one push cycle** when the market rotates (e.g., a live finance market expires and the next one loads). On rotation, all per-client state resets so the first delta is zero.

## Signal Design Reference

The signals are designed to cover non-overlapping dimensions:

| Signal       | Window    | Signed? | What it answers                          |
| ------------ | --------- | ------- | ---------------------------------------- |
| `price`      | instant (smoothed) | n/a | "Where is the market right now?"         |
| `price_delta_cents` | ~30s (fixed) | yes | "How many cents has price moved over the lookback?" (raw magnitude — for gain saturation) |
| `price_delta_band`  | ~30s (fixed) | yes | "Which gauge cell is lit?" (sensitivity-scaled band, -3..+3, 0=silence) |
| `price_moving` | 1 tick | n/a | "Is the price ticking this cycle?" (gate) |
| `price_move` | 45s–8min  | yes     | Legacy unitless integrator; same direction as `price_delta_cents`. |
| `momentum`   | 45s–8min  | yes     | "What's the sustained trend direction?"  |
| `velocity`   | 45s–8min  | no      | "How far has price ranged in the window?" (max − min) |
| `volatility` | 45s–8min  | no      | "How erratic/uncertain is the market?" (stddev) |
| `heat`       | composite | no      | "How active is this market overall?"     |
| `trade_rate` | 1min EMA  | no      | "How frequently are people trading?"     |
| `spread`     | ~9s mean  | no      | "How tight is the order book?"           |

### Key signal combinations for musicians

- **High volatility + low momentum** = "indecision" — market bouncing, no direction. Musical: tension, dissonance, rhythmic instability.
- **High volatility + high |momentum|** = "breakout" — volatile but directional. Musical: energy + direction, dramatic movement.
- **Low volatility + high |momentum|** = "steady trend" — calm, confident move. Musical: smooth ascending/descending phrases.
- **Low volatility + low momentum** = "quiet" — nothing happening. Musical: sparse, ambient.
- **High velocity + low volatility** = "orderly excursion" — price has travelled a range cleanly, not in a zigzag. Often pairs with strong momentum.
- **High velocity + high volatility** = "choppy trip" — price has covered ground but all over the place.

## Momentum: Technical Details

```
momentum = fast_EMA(smoothed_mid) − slow_EMA(smoothed_mid)
```

- Fast EMA period = window / 3
- Slow EMA period = window (sensitivity-scaled)
- Fast above slow → positive (uptrend); fast below slow → negative (downtrend)
- Normalized so ±5¢ EMA divergence → ±1.0

Dual-EMA over single price comparison: EMAs are self-smoothing and decay old data gracefully. A raw price-now-vs-price-N-ago comparison is dominated by whichever single sample landed at the far end of the window.

## Volatility: Technical Details

Standard deviation of the smoothed mid series over the sensitivity-scaled window:

```
volatility = min(1.0, stddev(smoothed_mids[-window:]) / 0.03)
```

3¢ stddev maps to 1.0 — same range as Bollinger band width. Because the input is already median-smoothed, a stddev of, say, 0.015 means real oscillation around the mean, not top-of-book noise.

## Velocity: Technical Details

```
velocity = min(1.0, (max − min) / 0.10)
```

over the smoothed mid series in the sensitivity-scaled window.

Max-min (range) rather than endpoint subtraction: a market that swung up 5¢ and back down reads 0.5 (5¢ range visited), not 0. That distinguishes it from `price_move` (which is signed and cancels out on mean-reverting moves) and gives tracks a stable magnitude signal.

## Price Move: Technical Details

```
price_move_raw = median(last 3 smoothed) − median(3 samples around window-ago)
pm_max         = PRICE_MOVE_MAX_30S · √(window_seconds / 30)
price_move     = sign · min(1.0, |price_move_raw| / pm_max)    # before edge-gate
```

Median on both endpoints means a single stray sample at either edge can't own the reading. `pm_max` scales with √window because price movement grows with √time for a random walk, so "saturated" means "a big move for this timescale" at any sensitivity.

After that raw read, an **edge gate** zeroes the output unless the magnitude is actively growing (>0.01 above the previous raw) or the direction has flipped with magnitude >0.15. This makes `price_move` quiet during sideways chop and during the tail of a completed move.

## Per-Client State

Each `ClientSession` (in `sessions.py`) keeps only the state that depends on that client's sensitivity or event history:

- Market selection (`market_slug`, `asset_id`)
- Sensitivity setting
- Event baselines (`_prev_heat`, `_prev_price`, `_prev_asset`, `_current_tone`)
- Dual-EMA state for momentum (`_ema_fast`, `_ema_slow`)
- Tick counter since rotation (`_ticks_since_rotation`) — drives the warmup fade and the `price_delta_cents` lookback clamp
- Previous smoothed mid for the `price_moving` gate (`_prev_gate_mid`)

The price history itself lives on the scorer (shared across all sessions watching the same market). Multiple sessions on the same market get the same underlying samples and compute their own sensitivity-dependent views over that shared series.

## Tone Hysteresis

Tone uses hysteresis to prevent major/minor flickering when price hovers near 0.50:

- Must drop below **0.45** to switch to minor
- Must rise above **0.55** to switch to major

Input is the smoothed mid, so the hysteresis band plus the smoother together comfortably absorb normal book-level noise.

## Price Display

The display price is the **smoothed mid** (scorer output). Before any book data arrives, it falls back to the **Gamma REST API** (`outcomePrices` field, polled every 5s via `price_poll_loop`).

## Outcome Selection

Markets have multiple outcomes (e.g., "Yes"/"No" or "Up"/"Down"), each with its own asset_id. `_primary_asset()` in `mixer.py` always picks the "Yes" or "Up" outcome to match the market's headline display.
