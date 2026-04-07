# Data-Music Interface

The server pushes **normalized market data** to each connected browser client via WebSocket every 3 seconds. Tracks receive data via their `update(data)` method and decide their own musical interpretation. **The server does not prescribe musical behaviour.**

## Data Values (pushed every 3s via WebSocket)

| Name          | Range      | Source                                                              |
| ------------- | ---------- | ------------------------------------------------------------------- |
| `heat`        | 0.0 – 1.0  | Composite market activity (velocity, trade rate, volume, spread)   |
| `price`       | 0.0 – 1.0  | Current price (WS bid/ask midpoint preferred, Gamma API fallback)  |
| `price_move`  | -1.0 – 1.0 | Edge-detected rolling price change. Uses 30s window but only emits non-zero when movement is *actively increasing* or direction flips. Also fires on slow cumulative drift (1.5¢+ creep since last detected move, graduated magnitude). Zero when price is truly flat. Signed. Normalized so raw 3¢ → magnitude 1.0 |
| `momentum`    | -1.0 – 1.0 | Signed trend direction (dual-EMA, MACD-inspired). Positive = trending up, negative = trending down. Window scales with sensitivity (45s–8min). See Sensitivity section |
| `velocity`    | 0.0 – 1.0  | Price velocity magnitude (unsigned, 5-min window, absolute: 10¢ move = 1.0) |
| `trade_rate`  | 0.0 – 1.0  | Trades per minute, normalized via adaptive EMA baseline            |
| `spread`      | 0.0 – 1.0  | Bid-ask spread, normalized (raw 0–0.3 → 0–1)                      |
| `volatility`  | 0.0 – 1.0  | Price oscillation / uncertainty (stddev over sensitivity-scaled window). High = erratic bouncing, low = stable. See Sensitivity section |
| `tone`        | 0 or 1     | 1 = major (price > 0.55), 0 = minor (price < 0.45), with hysteresis |
| `sensitivity` | 0.0 – 1.0  | Client's sensitivity setting (0=low, 1=high). Optional for tracks  |

## How Sensitivity Works

Sensitivity affects different signals in different ways, inspired by how traders use chart indicator periods:

### Window-scaled signals (sensitivity = period length)

`momentum` and `volatility` use sensitivity to control their **analysis window** — like changing a moving average period on a chart. This changes *what* the signal measures, not just how loud it is.

| Sensitivity | Window  | Trading analogy                        |
| ----------- | ------- | -------------------------------------- |
| 1.0 (max)   | ~45s    | Scalper — catches quick pumps/dumps    |
| 0.75        | ~1.3min | Intraday — responsive to short moves   |
| 0.5 (default)| ~2.5min| Day trader — medium-term trend         |
| 0.25        | ~4min   | Position — filters out noise           |
| 0.0 (min)   | ~8min   | Swing trader — only sustained moves    |

The curve is exponential: short-period differences matter more than long ones (9-EMA vs 20-EMA is a bigger difference than 180-EMA vs 200-EMA).

### Power-curve signals (sensitivity = amplitude)

`heat`, `velocity`, `trade_rate`, `spread`, and `price_move` are transformed by a power curve:
- At 50% (default): values are unchanged
- At 100%: small values are inflated (more reactive)
- At 0%: small values are crushed (less reactive)

### Unaffected signals

`price` and `tone` are never affected by sensitivity.

## Event Triggers (separate WebSocket messages)

| Event         | Fields                              | Condition                         |
| ------------- | ----------------------------------- | --------------------------------- |
| `spike`       | `magnitude: 0.0–1.0`               | Heat delta exceeds threshold (scaled by sensitivity) |
| `price_move`  | `direction: 1\|-1`, `magnitude: 0.0–1.0` | Price delta exceeds threshold (scaled by sensitivity) |
| `resolved`    | `result: 1\|-1`                     | Market resolved (1=Yes won, -1=No won) |
| `whale`       | `direction: 1\|-1`, `magnitude: 0.0–1.0`, `size: float` | Trade size ≥ 3x rolling median (outlier detection). Magnitude: 3x=0.33, 6x=0.67, 9x+=1.0. Size is raw USDC amount. |

Event **thresholds** are sensitivity-scaled (high sensitivity fires on smaller moves). Event **magnitudes** are raw — they tell the track how big the event actually was, so musicians can respond proportionally.

Events are **suppressed for one push cycle** when the market rotates (e.g., a live finance market expires and the next one loads). On rotation, all per-client state resets so the first delta is zero.

## Signal Design Reference

The signals are designed to cover non-overlapping dimensions:

| Signal       | Window    | Signed? | What it answers                          |
| ------------ | --------- | ------- | ---------------------------------------- |
| `price`      | instant   | n/a     | "Where is the market right now?"         |
| `price_move` | 30s fixed | yes     | "Is price moving NOW?" (includes slow drift detection) |
| `momentum`   | 45s–8min  | yes     | "What's the sustained trend direction?"  |
| `velocity`   | 5min      | no      | "How fast is price changing (any dir)?"  |
| `volatility` | 45s–8min  | no      | "How erratic/uncertain is the market?"   |
| `heat`       | composite | no      | "How active is this market overall?"     |
| `trade_rate` | 1min EMA  | no      | "How frequently are people trading?"     |
| `spread`     | instant   | no      | "How tight is the order book?"           |

### Key signal combinations for musicians

- **High volatility + low momentum** = "indecision" — market bouncing, no direction. Musical: tension, dissonance, rhythmic instability.
- **High volatility + high |momentum|** = "breakout" — volatile but directional. Musical: energy + direction, dramatic movement.
- **Low volatility + high |momentum|** = "steady trend" — calm, confident move. Musical: smooth ascending/descending phrases.
- **Low volatility + low momentum** = "quiet" — nothing happening. Musical: sparse, ambient.

## Momentum: Technical Details

Momentum uses a dual-EMA approach inspired by MACD:

```
momentum = fast_EMA(price) - slow_EMA(price)
```

- Fast EMA period = window / 3
- Slow EMA period = window (sensitivity-scaled)
- When fast EMA is above slow EMA → positive momentum (uptrend)
- When fast EMA is below slow EMA → negative momentum (downtrend)
- Normalized so ±5¢ EMA divergence → ±1.0

Why dual-EMA over simple price delta: EMAs are self-smoothing and naturally decay old data. A single price comparison (price now vs price N ago) is noisy — one outlier causes a jump.

## Volatility: Technical Details

Standard deviation of price over the sensitivity-scaled window, normalized:

```
volatility = min(1.0, stddev(prices[-window:]) / 0.03)
```

A 3¢ standard deviation maps to 1.0. This is the same calculation used for Bollinger Band width — when bands are wide, volatility is high.

## Per-Client State

Each client session (in `sessions.py`) maintains independent:
- Market selection (`market_slug`, `asset_id`)
- Sensitivity setting
- Event detection state (`_prev_heat`, `_prev_price`, `_prev_asset`, `_current_tone`, `_prev_price_move`)
- Dual-EMA state for momentum (`_ema_fast`, `_ema_slow`)
- Rolling price buffer (160 entries, 8 min at 3s intervals)

This means each user can watch a different market with different sensitivity, and all signal computation is independent per client.

## Tone Hysteresis

Tone uses hysteresis to prevent major/minor flickering when price hovers near 0.50:

- Must drop below **0.45** to switch to minor
- Must rise above **0.55** to switch to major

## Price Display

The display price uses the **WebSocket bid/ask midpoint** as the primary source (real-time). Falls back to the **Gamma REST API** (`outcomePrices` field, polled every 5s via `price_poll_loop`) when WebSocket data hasn't arrived yet.

## Outcome Selection

Markets have multiple outcomes (e.g., "Yes"/"No" or "Up"/"Down"), each with its own asset_id. `_primary_asset()` in `mixer.py` always picks the "Yes" or "Up" outcome to match the market's headline display.
