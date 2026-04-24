# Signal Primitives — First-Principles Architecture

Framework doc for how market signals should be shaped as musical inputs. Captures the vector-vs-scalar mental model, the reasoning behind the leaky-integrator proposal for `price_move`, and a phased implementation plan.

Status: **Framework** — agreed in conversation, ready to implement in phases.

## Premise

An instrument driven by a market signal is representing one of two things:

1. **Direction + magnitude.** "Which way is the price going, and how hard?" — a vector. Has a sign. Wants to return to zero when nothing is happening.
2. **Intensity.** "How much activity is there?" — a scalar. Unsigned. Zero-floored.

Today's pipeline treats these two families with different primitives but invented each one ad-hoc. On vector signals the result is a stack of transformations that fight each other (see `warmup-and-latency.md` for the specific artifacts on `price_move`). From first principles:

- Vectors want a **signed, decaying state** driven by deltas. The canonical primitive is a leaky integrator.
- Scalars want a **smoothed rate estimate**. The canonical primitive is an EMA of the raw rate.
- Sensitivity is one knob: **timescale**. Every signal should derive its smoothing/decay from that single knob, not from a separately-invented curve per signal.

## User-facing framing — timescale as the slider

Today the UI exposes "Sensitivity" as an opaque 0–1 slider. Once the internal math treats sensitivity as a single timescale, the slider itself should be relabelled to match — **timescale is the natural unit in any trading chart** (1m, 5m, 15m, 1h…). Traders already think in those terms when they look at prediction-market price action, so the slider should meet them there.

Replacing the abstract 0–1 number with named presets (or a continuous slider calibrated in seconds/minutes) makes the contract explicit: "what counts as a 'move' on this session?" The rest of the pipeline — `price_move` decay, `velocity` / `volatility` / `momentum` windows — follows from that one choice automatically.

Suggested preset labels (tunable):

| Label | Timescale | Character |
|---|---|---|
| Scalper | ~15 s | Reacts to every flicker; expects a busy market |
| Intraday | ~2 min | Default; responds to real moves without chasing jitter |
| Swing | ~15 min | Only sustained trends register; ignores short-term chop |
| Event | ~1 hr | News-horizon — silent unless something massive happens |

An Event-scale preset is exactly the "wake me when the world breaks" mode: a 1¢ flicker doesn't move the needle at all, but a news-driven 5–10¢ jump builds up strongly and then decays over the hour.

**Asymmetry to flag.** Vector signals (`price_move`, `momentum` via dual-EMA) scale to any timescale for free because they're state-based, not buffered — a 1-hour half-life has the same implementation cost as a 15-second one. **Windowed scalars** (`velocity`, `volatility`) are capped by `MID_HISTORY_MAXLEN = 200` samples ≈ 10 min. That's fine in practice: those signals drive musical texture, not alerts, and a 10-min window is already longer than any reasonable musical phrase. The long-horizon presets only need to reshape vector signals.

Internally this is the same knob as today's `sensitivity` — just relabelled on the wire and in the UI. This is a UX change, not a data-model change, so it's orthogonal to the price_move fix and ships naturally with Phase 6.

## Signals and the primitive each one wants

| Signal | Shape | Right primitive | Today |
|---|---|---|---|
| `price_move` | Vector | Leaky integrator of Δmid | Median-of-3 tail vs median-of-3 at window-back + edge detector + in-track gate |
| `momentum` | Vector | Dual-EMA divergence (MACD-style) | Dual-EMA divergence — ✓ keep |
| `tone` | Boolean | Hysteresis on smoothed mid | Hysteresis — ✓ keep |
| `velocity` | Scalar | Max−min range over window (or EWMA of \|Δmid\|) | Max−min range — ✓ keep |
| `volatility` | Scalar | Windowed stddev | Windowed stddev — ✓ keep |
| `heat` | Scalar composite | Weighted sum of sub-scalars | Weighted sum — ✓ keep |
| `trade_rate` | Scalar | Adaptive EMA + log ratio | Adaptive EMA + log ratio — ✓ keep |
| `spread` | Scalar | EMA over recent samples | EMA — ✓ keep |

**Only `price_move` is getting the wrong primitive today.** Everything else is broadly correct. The work described below is narrowly scoped to replacing `price_move`'s implementation while leaving its output contract (signed float in [−1, 1]) unchanged, so tracks, sandbox, and UI don't need to move.

> **Name collision note.** `price_move` today is overloaded: there's also a per-tick discrete *event* with the same name (fires on raw `|last_price − prev_price|`, `server.py:334`). Phase 1 renames the event to `price_step` so the continuous signal owns the name unambiguously. See `events.md` §4.

## Mental model — a swing

A child on a swing that you're standing behind:

- Every price tick up = a small push forward. Every price tick down = a small push backward.
- Nothing holds the swing up — it always drifts back to rest (the "leaky" part).
- Sustained same-direction pushing = the swing climbs higher (growing magnitude).
- Stop pushing = it coasts back to centre over a few seconds.
- Push the other way mid-swing = it reverses through zero naturally.

Sensitivity is how heavy the swing is: a light swing (sens=1, short half-life) darts on every little push and settles fast; a heavy swing (sens=0, long half-life) ignores jitter and only gets going under sustained pushing.

This is the mental model `price_move` should match. It maps 1:1 onto the DSP primitive.

## Math

```
Δmid = smoothed_mid[t] − smoothed_mid[t−1]        # signed single-tick change
pm_v = (1 − k) · pm_v  +  g · Δmid                # leaky integrator state

where
  k    = per-tick decay rate, derived from sensitivity (half-life)
  g    = gain, normalises typical Δmid into a useful 0–1 range
  pm_v = the new price_move output (signed, bounded; clamp to [−1, 1] on read)
```

Deriving `k` from sensitivity `s ∈ [0, 1]`:

```
half_life_secs = hl_min · (hl_max / hl_min) ^ (1 − s)
k              = 1 − 2 ^ (−DATA_PUSH_INTERVAL / half_life_secs)
```

Starting values: `hl_min = 15 s`, `hl_max = 3600 s` (1 hr), `DATA_PUSH_INTERVAL = 3 s`:

| Sensitivity | Preset | Half-life | k per 3s tick |
|---|---|---|---|
| 1.00 | Scalper | 15 s | ≈ 0.13 |
| 0.55 | Intraday | ≈ 2 min | ≈ 0.017 |
| 0.25 | Swing | ≈ 15 min | ≈ 0.0023 |
| 0.00 | Event | 1 hr | ≈ 0.00058 |

Stretching the range to 1 hr costs nothing — the integrator is a single float of state. The mapping is log-uniform so the slider feels linear across the "scalper → news-horizon" range.

Starting value for gain: `g ≈ 20` aims for a sustained 3¢ move over one half-life to approach `pm_v ≈ 1.0` (full saturation), while a one-shot 3¢ tick lands around `pm_v ≈ 0.6` (mid-band). Tune by ear in Sandbox. Note that `g` interacts with half-life — at the Event preset, the integrator accumulates across far more ticks before decay catches up, so `g` may need to scale down (or become a function of half-life) to avoid the long-horizon preset saturating on routine drift. Confirm in Phase 2.

## What goes away

Compared to today's `price_move` path (`server.py:350–393`):

| Deleted | Reason |
|---|---|
| `tail_med = median(last 3)` | Raw mids are already median-smoothed in `scorer.sample_mid`. Second median is redundant. |
| `head_med = median(3 around len−window)` | Same, and the window-diff framing is the root problem. |
| `raw_move = tail_med − head_med` | "Window slides past a move" artifact — keeps reading non-zero long after price has settled. |
| `pm_max = 0.03 · √(window_sec/30)` | No longer needed — sensitivity enters as decay rate, not as window scaling. |
| Edge detector (same-dir growing, flip ≥ 0.15) | Band-aid for the window-diff artifact. Leaky integrator decays naturally — no detector needed. |
| `session._prev_price_move` | Replaced by `session.pm_v` state. |

Weather Vane's in-track gate (`weather_vane.js:124`) becomes optional — the leaky integrator is quiet enough on its own that a dead-zone isn't structurally needed. Keep or remove after listening.

`MID_SMOOTH_WINDOW = 3` in the scorer (`scorer.py:33`) can drop to 1 (pass-through). It was rejecting book outliers; the integrator already low-passes single-sample spikes for free. Defer until Phase 1 is in and we can A/B against it.

## Interactions with the discrete event layer

The discrete event system is audited separately in `events.md`. After that audit we shipped a simpler event layer: `spike`, `price_step`, `resolved`. The `whale` event was removed (dead code with live bugs — no track consumed it, and `events.md` §7 lists "remove" as a valid option). The four `Event:` log lines in `app.js` are gone too — the log panel is diag-only. The remaining two issues from that audit intersect this refactor and are folded into the phases below.

**In scope here:**

- **Name collision on `price_move` (`events.md` §4).** With the leaky integrator in place, the continuous `price_move` gets a much clearer identity — a signed, decaying vector. Keeping a same-named event that fires on per-tick raw deltas would make the collision worse, not better. Fix at Phase 1: rename the event to `price_step`, update the two consuming tracks (`late_night_in_bb.js`, `digging_in_the_markets.js`).

- **Event thresholds misuse `sens_exp` (`events.md` §3).** `server.py:331-337` scales `spike` and `price_move` event thresholds by multiplying by `sens_exp`, which is a power-curve exponent (0.25–4.0), not a linear scalar. The direction is right (shorter timescale → more events), but the magnitudes are a coincidence of reusing the wrong variable, and at sens=0.0 the thresholds are so large that `spike` effectively cannot fire. Once Phase 6 unifies sensitivity into a single timescale, `sens_exp` is gone entirely — so event thresholds need to be redefined explicitly in terms of half-life. Proposed: `threshold = base · (DEFAULT_HALF_LIFE / half_life)`. Keeps the intended direction with dimensionally honest math.

**Resolved in the "Prune whale + drop Event logs" commit:** whale bugs (§1, §2, §5) became moot — the whole event was removed. Log-panel noise (§6) fixed by dropping all four `Event:` lines from `app.js`. Whale keep-or-remove decision (§7) settled: remove.

**Architectural note.** The leaky integrator blurs the line between "continuous signal" and "event" for vector signals — the integrator's output naturally has event shape (impulse + decay). In principle, tracks that currently stab on the `price_move` event could watch rising edges of the continuous signal instead and get the same effect with one fewer channel. Not proposed here (rising-edge detection in track code is more complex than a single event callback), but worth noting as future simplification if the event layer becomes a maintenance burden.

## Phased implementation

One commit per phase. Each phase is independently rollbackable and produces a testable state.

### Phase 1 — Add the leaky integrator behind `price_move`, end the name collision

- Add `pm_v: float = 0.0` to `ClientSession`.
- In `_compute_market_data`, replace the median/window/edge-detection block (`server.py:350–393`) with the leaky-integrator update above.
- Derive `k` from `session.sensitivity` and `DATA_PUSH_INTERVAL`; pick `g` from the starting value.
- On rotation, reset `pm_v` to 0 (already handled by the rotation block — just add `pm_v = 0.0` alongside `_prev_price_move = 0.0` for now; delete the latter in Phase 5).
- Output key, sign convention, and clamp range unchanged: signed float in `[−1, 1]` under `price_move`.
- **Rename the per-tick `price_move` event to `price_step`** (`server.py:334-337`). Update `late_night_in_bb.js:721` and `digging_in_the_markets.js:493` to listen on the new name. This ends the name collision before anything else depends on it. See `events.md` §4.
- Validate in Sandbox: step-function move, flat market, oscillating market, direction reversal. Confirm flat markets produce `pm_v → 0`. Confirm the two event-consuming tracks still trigger on raw price steps.

### Phase 2 — Tune `g` and half-life bounds by ear

- With Weather Vane playing and Diagnostics narrating live price, confirm:
  - Real 2–3¢ moves fire a 3- or 5-note run within one cycle.
  - 5–10¢ moves saturate into 8-note runs.
  - Flat markets are silent.
  - Direction reversals audibly pass through zero.
- Adjust `g`, `hl_min`, `hl_max` if responses feel too hot or too cold. Note that sensitivity now controls *only* decay rate — no separate magnitude scaling to worry about.

### Phase 3 — Drop `MID_SMOOTH_WINDOW` from 3 → 1

- `scorer.py:33`. One-line constant change.
- Re-test with Diagnostics + Weather Vane. If a specific market shows one-tick noise breaking through audibly, reconsider (either revert or bump to 2).

### Phase 4 — Remove or soften Weather Vane's in-track gate

- `weather_vane.js:124`. Either delete the `gateThresh` check entirely or floor it at a small constant (e.g., 0.08) that survives regardless of sensitivity.
- Listen with Diagnostics to confirm no new phantom firing.

### Phase 5 — Delete retired state and constants

Once Phases 1–4 have been listened to and accepted:

- Remove `_prev_price_move` from `ClientSession`.
- Remove `PRICE_MOVE_MAX_30S` from `config.py`.
- Remove edge-detection commentary and `price_move` details that no longer apply from `server.py`, `docs/data-interface.md`, and `docs/musician-brief.md`.
- Update `weather_vane.js` header comment to reflect the new signal model.

### Phase 6 (optional, independent) — Unify sensitivity as a single timescale, relabel the UI, reshape event thresholds

Not needed to fix Weather Vane, but a natural next step once Phase 1 proves out the "sensitivity → decay rate" mapping:

- Define one helper `sensitivity_timescale(s) → seconds`.
- Express each signal's smoothing / window / decay in terms of that single timescale.
- Removes three different sensitivity mappings (power curve on intensities, window-length curve on slopes, √t scaling on price_move max) in favour of one.
- **Relabel the client-side "Sensitivity" slider as "Time window"** with named presets (Scalper / Intraday / Swing / Event, or explicit durations like 15s / 2m / 15m / 1h) — matches how traders read charts and makes the contract legible. The existing 0–1 value stays as the underlying wire format; this is pure UX.
- **Reshape event thresholds (`spike`, `price_step`) to scale by half-life ratio** instead of `sens_exp`. Today `server.py:331-337` multiplies thresholds by `sens_exp` (a power-curve exponent, 0.25–4.0), which is dimensionally meaningless — direction is right, magnitudes are coincidence. Replace with `threshold = base · (DEFAULT_HALF_LIFE / half_life)`: short timescale → small moves count as events, long timescale → only big moves do. At the Event preset (1 hr half-life) this means `price_step` only fires on ≥ 10¢ jumps, matching the "only alert on massive moves" intent. Fixes `events.md` §3.
- Can ship any time after Phase 1 and is independent of the rest.

## Non-goals

- Reducing `DATA_PUSH_INTERVAL` below 3 s — deferred; would require retuning every track's cpm and pattern scheduling assumptions.
- A faster side-channel for alert-style tracks — interesting architectural idea, but much bigger than this doc's scope.
- Touching `heat`, `momentum`, `trade_rate`, `spread`, `tone`, `velocity`, or `volatility` primitives — those are broadly correct today.

## Related

- `docs/development/warmup-and-latency.md` — warm-up diagnosis (separate issue) plus the latency breakdown that led to this rework. Phases here supersede Latency steps #2–#4 of that doc; warm-up Part A is unaffected.
- `docs/development/events.md` — discrete event layer audit. §3 (`sens_exp` misuse) and §4 (`price_move` name collision) are addressed in Phases 1 and 6 here; §1, §2, §5, §6, §7 are orthogonal and remain tracked there.
- `docs/data-interface.md` — client-facing signal definitions; updated in Phase 5.
- `frontend/sandbox.html` — where Phase 1 gets validated before real-market listening.
