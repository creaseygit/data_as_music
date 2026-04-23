# Warm-up & Latency

Working doc for two related, user-raised issues: the market tune-in/warm-up period feels long and opaque, and Weather Vane noticeably lags visible price moves. This doc captures both the diagnosis and the plan so neither half gets dropped.
Status: **Plan** — approach agreed in conversation, ready to implement.

## Problems

### 1. Warm-up / tune-in is long and misleading

When a user pins a market, two separate mechanisms act as "warm-up":

- **18-second smoothstep fade** (`config.py:41`, `server.py:131-139`) scales every activity signal (`heat`, `velocity`, `trade_rate`, `spread`, `volatility`, `momentum`, `price_move`) from 0 toward 1 via an ease-in curve. Events are suppressed while `w < 1.0`. Price and tone are exempt.
- **"Tuning in · ready in Xm Ys" banner** (`frontend/app.js:551-565`) renders until `window_fill >= 0.98`, where `window_fill = len(history) / sens_window`. At sens=0.5 that's ~2.5 min; at sens=0.0 it's ~8 min. The banner can honestly say "ready in 4 minutes" even though the music is already playing and most signals are functional well before then.

The result: the system is working but feels broken. The 18s fade is arbitrary ease-in, not tied to data availability; the banner reports the pessimistic window-fill time as if it were a blocker.

### 2. Weather Vane lags visible price moves

Accumulated latency from a real Polymarket trade to an audible Weather Vane note is **3–10 seconds** in normal operation. Breakdown:

| Layer | Contribution | Type |
|-------|--------------|------|
| Market WS → scorer | ~50 ms | hard floor |
| Broadcast cadence (3 s fixed, `config.py:38`) | 0–3 s | hard floor |
| 3-sample rolling median on mid (`market/scorer.py:93-123`) | 0–6 s | smoothing |
| `price_move` edge detection with hysteresis (`server.py:321-364`) | conditional | by design |
| Audio-engine cycle-boundary scheduling (`audio-engine.js:254-397`) | 0–3 s | pattern-driven |
| Damping on `price_move` (`audio-engine.js:18-26`, α=0.4) | 5–10 s | intentional smoothing |
| Weather Vane in-track gate (`weather_vane.js:126`, `gateThresh ≈ 0.475` at sens=0.5) | conditional | by design |

Two of these are fighting the track's job. Weather Vane is the "there's a directional move happening" alert — its `price_move` input is edge-detected and event-shaped — yet:

- `price_move` is in `DAMPED_SIGNALS`, so the track sees a 5–10 s EMA-converged version of the server's value. Damping is for continuous musical parameters (heat, volatility); smoothing an event signal blunts its purpose.
- The in-track `gateThresh = 0.05 + (1 - sens) * 0.85` requires moves ≥ 47.5% of saturated magnitude at default sensitivity. The server already filters noise via `price_move` edge detection; this second gate explains why small-but-visible moves produce no sound.

## Design

### Part A — Stabilise warm-up for both short- and long-lived markets

Polymarket's CLOB exposes a public, no-auth history endpoint: `GET clob.polymarket.com/prices-history?market={token_id}&interval=1h&fidelity=1` returns ~60 minute-spaced `{t, p}` points. Confirmed working from the UAE via VPN (200, ~0.9 s). **Minimum granularity is 1 minute**, regardless of `fidelity` or `startTs`/`endTs` — there is no sub-minute history available.

The catch: **live-finance markets (5 m / 15 m crypto updown) return `{"history":[]}` while fresh.** Backfill alone doesn't cover them, and these markets will always be a first-class concern because the auto-rotator selects them.

Unified strategy — backfill when possible, adapt windows when not, in all cases short-fade the warm-up:

1. **Backfill on market pin (long-lived markets).**
   - New `market/clob_history.py` with `fetch_price_history(token_id, interval='1h', fidelity=1)`. Runs async with a short timeout (~2 s). If it fails, returns `None`; we fall through to step 2 without blocking audio start.
   - On success, linearly upsample the 1-min-spaced points to 3 s spacing and seed `scorer.price_history[token_id]` and `scorer._raw_mid_samples[token_id]` before the first broadcast tick.
   - With a full history buffer seeded, `window_fill` is ≈ 1.0 on tick 1 regardless of sensitivity; window-based signals reach full magnitude immediately.

2. **Adaptive sensitivity window (short-lived markets).**
   - When pin target has a near-term `endDate` (live-finance pattern), cap `sens_window_seconds` to `min(sens_window_seconds, remaining_market_seconds / 2)` with a floor of 30 s.
   - A freshly-opened 5-min market with full 5 min remaining and sensitivity at 0 would normally want an 8-minute window (longer than the market). Cap forces it to ~150 s, which naturally fills inside ~50 ticks.
   - Seed `_raw_mid_samples` with a few copies of the first real bid/ask mid the scorer sees, so the 3-sample median smoother is immediately valid.

3. **Shorten and relabel the warm-up fade.**
   - Reduce `WARMUP_DURATION` from 18.0 → 4.0 s. The fade exists to prevent audio pops and mask first-tick noise; 4 s is sufficient for both purposes. When backfill succeeds, the fade is mostly cosmetic anyway.
   - Drop the "Tuning in · ready in Xm Ys" framing. Replace with a brief, non-scary "Tuning in" tag that fades out at `t >= WARMUP_DURATION`, independent of `window_fill`. Window fill can move to the existing price chart (per `price-chart-visualization.md`) as a subtle history-length indicator rather than a blocker.

4. **Events during warm-up.** Keep event suppression for the first 4 s (prevents spurious spikes on first-tick noise). Unchanged vs today except for the shorter duration.

### Part B — Latency fixes for Weather Vane

Small, targeted changes in priority order. Each is independent and rollbackable.

1. **Expand Diagnostics to announce price changes in real time.** Before changing any signal path, make the 3 s broadcast floor audibly obvious so we can tell signal-path fixes from perceptual/cadence issues.
   - In `frontend/tracks/diagnostics.js`, on every tick: if `|price - lastAnnouncedPrice| >= 0.005` (0.5¢), `speak("{pricePct}")` and update `lastAnnouncedPrice`.
   - Keep the existing heartbeat as a fallback for silent periods (no change ≥ 0.5¢). Consider halving `HEARTBEAT_MIN_SECS` so heartbeats land more often at scalper sensitivity.
   - Goal: when listening on Diagnostics alongside Weather Vane, the user can hear the pipeline's true cadence and distinguish "Weather Vane suppressed this move" from "the pipeline is slow here."

2. **Remove `price_move` from `DAMPED_SIGNALS`.** `frontend/audio-engine.js:23-26`. One-line change. Damping is for continuous musical parameters; `price_move` is an edge/event signal that the server already shapes. Keep damping on `heat`, `velocity`, `trade_rate`, `spread`, `volatility`, `momentum`.

3. **Soften or remove the Weather Vane in-track gate.** `frontend/tracks/weather_vane.js:126`. Either:
   - Remove the `gateThresh` check entirely and rely on server-side edge detection + magnitude quantisation, or
   - Floor the threshold at a small constant (e.g., `0.1`) regardless of sensitivity, so moves beyond server noise always fire.
   - Verify via Diagnostics that the resulting sound matches visible price activity.

4. **Reduce mid median smoothing from 3 → 1 sample (optional).** `market/scorer.py:33-38` (`MID_SMOOTH_WINDOW`). The rolling median is meant to reject order-book outliers, but it persists real 1-tick moves for 1–2 ticks. With 3 s sampling and the scorer's bid/ask inputs already smoothed by Polymarket's order book, a 1-sample "smoother" (i.e., raw passthrough) may be cleaner. Defer until Diagnostics-under-real-moves tells us whether the median is actually hiding responsiveness.

5. **Reduce `DATA_PUSH_INTERVAL` (deferred, higher-risk).** Dropping from 3.0 s → 1.5 s halves the broadcast floor but changes the implicit tempo every track is tuned against (cycle lengths, damping convergence, Strudel pattern scheduling). Only attempt after 1–4 land and only if Weather Vane still feels lagged. Would require re-tuning each track's `cpm` and verifying no pattern lookup assumes 3 s ticks.

## Rollout plan

One commit per numbered item below so each change is bisectable and revertable.

1. **Expanded Diagnostics (Latency #1).** Ship first — it's the measurement instrument for everything after.
2. **Remove `price_move` from damping (Latency #2).**
3. **Soften Weather Vane gate (Latency #3).** Listen with Diagnostics; pick "remove entirely" vs "floor at 0.1" based on what sounds right.
4. **Warm-up fade + banner (Design Part A, step 3).** Lower `WARMUP_DURATION`, drop the "ready in Xm Ys" countdown. Independent of backfill — ships even if backfill is delayed.
5. **Adaptive sensitivity window for live finance (Design Part A, step 2).** Before backfill because it's self-contained and covers the hardest case.
6. **CLOB history backfill (Design Part A, step 1).** The biggest win for long-lived markets, but also the most code (new module, async fetch, upsampling, seeding). Ship after steps 4–5 confirm the non-backfill path is solid.
7. **Mid median → 1 sample (Latency #4).** Only if Diagnostics still shows smoothing-related delay after the above.
8. **Broadcast interval (Latency #5).** Only if the user still reports lag after everything above. Breaking change — treated as "last resort."

## Resolved decisions

- **Backfill even single points for short markets.** Even one history point is informative: Weather Vane (and every window-based signal) is change-based — no change, no sound. Seeding a 5-min market with just 1 prior point gives tick 2 a reference to compute a direction against.
- **Diagnostics cadence: max one utterance per 5 s, and skip if one is still speaking.** Reading "price: fifty-two" takes 2–3 s; five seconds is a safe floor. Use `speechSynthesis.speaking` to gate starts, not `.cancel()` to interrupt.

## Open questions

- **Variable spacing safety.** `scorer.price_history` stores `(timestamp, mid)` tuples, so it *represents* non-uniform gaps, but the `_compute_market_data` window math walks by entry count, not time. Backfilled 1-min-upsampled-to-3s points will be uniform by construction, so this is fine as long as we upsample correctly. Need to sanity-check that `price_velocity`, `price_move`, and `momentum` all behave correctly on the seeded buffer before the first real tick arrives.

## Related docs

- `docs/data-interface.md` — signal definitions, sensitivity mechanics, event triggers
- `docs/development/price-chart-visualization.md` — where window-fill info should ultimately live once the chart replaces signal strips
- `docs/gotchas.md` — prior known-issue notes for the pipeline
