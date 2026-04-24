# Price Chart Visualization

Working doc for replacing the horizontal-bar signal strips with a time-based price chart that makes the sensitivity threshold legible and exposes the warmup phase honestly.
Status: **Design** — gathering input before prototyping.

## Problem Statement

The Now-Playing panel currently renders eight horizontal bars to communicate market state to the listener:

- `price` — a needle between 0–100% on a horizontal track
- `price_move`, `momentum` — signed fills, expand left/right from centre
- `volatility` — unsigned fill
- `heat`, `velocity`, `trade_rate`, `spread` — unsigned fills with a "raw tick" indicating where the bar would read at neutral sensitivity

Three things aren't working:

1. **No time dimension.** The listener can't see that the price has been drifting for two minutes, or that it just reversed direction. Each tick is a snapshot with no memory of the last one.
2. **Sensitivity is abstract.** The sensitivity slider reshapes signals via a power curve (activity signals) or a √window-scaled threshold (price-family signals). Today we surface this as a "raw tick" on activity bars and a "window fill %" next to window-scaled bars. Neither makes it obvious *what price change would fire a signal* at the current sensitivity — the whole point of the slider.
3. **Warmup is hidden.** After switching markets, the client needs up to 8 minutes at the lowest sensitivity to fill the price-history buffer. Today this shows as a growing "window fill" bar, which is visible but opaque: the user has no felt sense of "we have 30 seconds of data" vs "we have 8 minutes of data". Activity signals also tween from zero via a warmup factor over 18s; that's silent too.

The horizontal bars are good at communicating *current level* but bad at everything else. A chart gives us the missing time axis without losing the level read.

## What Data We Have (per 3s tick)

Every `DATA_PUSH_INTERVAL` seconds (3s) the server pushes a JSON blob per client containing:

| Field | Range | Axis | Notes |
|-------|-------|------|-------|
| `price` | 0–1 | price | Smoothed mid, 0 = 0%, 1 = 100% |
| `price_move` | −1 to +1 | price | Signed; saturates at ±`pm_max` price delta within window |
| `momentum` | −1 to +1 | price | Signed; first derivative of price_move (acceleration) |
| `volatility` | 0 to 1 | price | Stddev of recent mids within window |
| `heat` | 0 to 1 | activity | Weighted combo: velocity·0.35 + trades·0.40 + volume·0.15 + spread·0.10 |
| `velocity` | 0 to 1 | activity | Rate of mid change |
| `trade_rate` | 0 to 1 | activity | Trades per unit time |
| `spread` | 0 to 1 | activity | Bid/ask gap |
| `tone` | 0 or 1 | — | 0 = bearish, 1 = bullish |
| `sensitivity` | 0 to 1 | — | Current slider value |
| `window_seconds` | 45 to 480 | — | Target window length from sensitivity |
| `window_fill` | 0 to 1 | — | Fraction of target window backed by real buffered data |

The server does not push price history — each client would need to buffer its own series from `price` ticks.

### The Sensitivity Threshold, Precisely

For the price-family signals, sensitivity sets both a **lookback window** and a **saturation threshold**:

- Window: `max(4, round(160 · (15/160)^sensitivity))` entries, each 3s apart.
  - sens = 1.0 → 15 entries → **45 seconds** (scalper)
  - sens = 0.5 → ~49 entries → **~2.5 minutes** (day trader)
  - sens = 0.0 → 160 entries → **8 minutes** (swing trader)
- `price_move` is the signed difference between median-of-last-3-ticks and median-around-the-oldest-tick-in-the-window, normalised by `pm_max`.
- `pm_max = PRICE_MOVE_MAX_30S · √(window_seconds / 30)` where `PRICE_MOVE_MAX_30S = 0.03` (3¢).
  - sens = 1.0 (45s window): `pm_max` ≈ 3.7¢ — a 3.7¢ move in 45s fires ±1
  - sens = 0.5 (~150s window): `pm_max` ≈ 8.2¢ — needs a bigger move to fire ±1
  - sens = 0.0 (480s window): `pm_max` = 12¢ — only big sustained moves register

**This is the quantity the chart's bands should show:** `price ± pm_max` (or equivalently, the price level that, if the next tick reached it, would push `price_move` to ±1 at the current sensitivity).

### Edge Detection (watch out)

`price_move` is edge-detected server-side: it only emits while the move is *actively growing*. Once a move finishes, `price_move` decays to zero even though the band on a naïve chart would still sit at that wider distance. This matters for the visualisation — the bands reflect "what *would* fire a signal from here," not "what is currently firing." The chart needs to accommodate both readings without implying the signal is currently hot when it isn't.

## Current UX and Why It's Unclear

The current strip for `price_move`:

```
Price Move  [────────▓▓▓▓│▓▓▓──────────]  [▓▓▓▓▓▓░░░░░ 2.5m]
            ← negative   centre   positive →   window fill / target
```

To answer "is a signal about to fire?", the user must:
1. Read the signed fill width (how big the move is, normalised)
2. Remember that the width is scaled by the sensitivity window
3. Check the window-fill bar on the right to see if the buffer is even full
4. Infer what raw price change corresponds to ±1 at this sensitivity

None of this is visible as an actual price. It's all abstract ratios.

## Proposed Approach

Replace the four price-axis strips (`price`, `price_move`, `momentum`, `volatility`) with a single chart:

- **X axis:** time, spanning the current sensitivity window (re-scales as the slider moves).
- **Y axis:** price, 0–100%, probably auto-zoomed to the recent range so small moves are visible.
- **Line:** the live `price` series, buffered client-side, rendered left-to-right as it accumulates.
- **Bands (upper/lower):** `price ± pm_max`, redrawn each tick. These are the "bollinger-style" bands but have a precise meaning: cross a band and `price_move` saturates at ±1. The band width shrinks as sensitivity rises (shorter window → smaller `pm_max`) and widens as sensitivity falls.
- **Warmup indication:** when `window_fill < 1`, the line only spans the right portion of the chart. A label like "gathering data — 1m 12s / 2m 30s" or a subtle hatched area on the left makes the empty space intentional rather than "broken chart".
- **Momentum:** optional overlay — a small second axis, or a subtle curvature/colour on the price line itself. Worth prototyping both before deciding.
- **Volatility:** could widen or gradient-fill the band area, since volatility is already "how much price is moving within the window". Needs care to not conflict with the `pm_max` bands.

Keep the four activity-axis strips (`heat`, `velocity`, `trade_rate`, `spread`) roughly as-is for now — they live on a different axis (magnitude of market activity, not price) and don't fit the chart metaphor. They can sit below or beside the chart.

## Open Design Questions

1. **Time-axis scaling.** Does the x-axis match the sensitivity window (chart re-scales with the slider), or stay fixed at e.g. 5 min while the bands inside change width? The first makes the slider's effect more dramatic; the second makes history easier to compare across sensitivity settings.
2. **Warmup affordance.** Is the visibly-shorter line enough, or do we need an explicit "gathering data" label / hatched region / countdown?
3. **What happens to the four activity bars.** Keep as-is below the chart? Shrink to compact pills? Move beside the chart? Layout decision.
4. **Momentum and volatility rendering.** Separate mini-chart, overlay on the price line, or fold into the band shape? Each has tradeoffs for visual density.
5. **Y-axis zoom.** Auto-zoom to recent range (small moves feel big), fixed 0–100% (honest scale but small moves vanish), or toggle? Prediction markets often sit at 2% or 98% for long stretches, where a fixed scale is useless.
6. **Tone (bullish/bearish).** Currently sets the header colour. Should the chart reflect tone too — tinted line, tinted band, background wash?
7. **Event triggers.** When an event fires (e.g. a `spike` or `price_step`), do we annotate the chart (dot, flash on the line) or keep that in the existing strip-flash system? A chart makes annotations natural.
8. **Historical depth vs. live focus.** Is the chart a rolling window (always shows "last N seconds"), or does it pan as the market plays so the user sees accumulated history growing? Rolling is simpler; panning is more "I've been listening for a while".

## Non-Goals

- This is not a trading chart. No candles, no indicators, no volume bars. It exists to communicate the sensitivity threshold and the warmup state, not to replace TradingView.
- History does not persist across sessions or page reloads. The buffer resets when you load the app or switch markets, and that's fine — the music is live, not historical.
- We're not replacing the activity-axis signals (`heat`, `velocity`, `trade_rate`, `spread`). Those remain as bars.
- We're not changing what data the server pushes. The chart is a client-side render over the existing tick stream.

## Implementation Sketch (once we've agreed on UX)

- Client-side ring buffer keyed on market slug: `{ t, price }[]`, cleared on market switch, capped at e.g. 600 entries (30 min at 3s ticks).
- Render via SVG (simple, accessible, DOM-inspectable) or canvas (cheaper redraw; only matters if we animate). SVG likely fine at 3s cadence.
- Bands redrawn each tick from the incoming `pm_max` (derivable from `sensitivity` and `window_seconds` using constants already mirrored in `app.js`, or pushed as an explicit field).
- Replace `_STRIP_DEFS` entries for the four price-axis signals with a chart component; keep the activity entries.
- Sandbox page (`/sandbox`) gets the same chart so it can be tuned with simulated data.

## References

- `server.py` — `_sensitivity_window`, `_warmup_factor`, and the price_move computation block (around line 325) define the precise band-width formula.
- `config.py` — `PRICE_MOVE_MAX_30S`, `DATA_PUSH_INTERVAL`, `WARMUP_DURATION` are the tunable constants behind all of the above.
- `frontend/app.js` — `_STRIP_DEFS`, `_updateSignalStrips`, `_updateSensitivityOverlay` are what this replaces.
- `docs/data-interface.md` — authoritative description of every pushed field and its sensitivity behaviour.
