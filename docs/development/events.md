---
name: Events system audit
description: Problems with the discrete event system (spike / price_move / whale / resolved) — delivery bugs, weak detection priors, log noise, unused triggers. Proposed fixes.
type: development
---

# Events — Audit & Fix Plan

Working doc on the discrete event layer (`spike`, `price_move`, `whale`, `resolved`). User flagged a burst of ~20 identical `Event: whale trade` lines in the UI log within a few seconds and questioned whether the events are valid at all. Investigation surfaced several related issues, not just the log noise. This doc collects them so any fix is scoped deliberately.

Status: **Diagnosis** — no changes made yet, options listed at the end.

## What events are

The pipeline emits four discrete events alongside the continuous signals on every 3 s broadcast tick:

| Event | Source | Emitted when |
| --- | --- | --- |
| `spike` | `server.py:331` | `|heat - prev_heat|` exceeds a threshold |
| `price_move` | `server.py:334` | `|last_price - prev_price|` exceeds a threshold |
| `whale` | `scorer.py:227`, drained at `server.py:338` | Trade size ≥ 3× rolling median of last 200 trades (after 10-trade warmup) |
| `resolved` | `mixer.py:201-213` | CLOB WebSocket emits `market_resolved` for the pinned asset |

Only two tracks consume events (`late_night_in_bb.js:721`, `digging_in_the_markets.js:493`), and neither reacts to `whale`. `weather_vane.js:144` and `so_over_so_back.js:122` explicitly return `null`. So the whale event in particular is currently cosmetic — it only produces log lines.

## Problems

### 1. Whale events flood on every market switch (delivery bug)

The 20-whales-in-3-seconds pattern in the UI log isn't a real burst of whale trades. It's a session-state bug.

- `ClientSession._last_whale_check` starts at `0.0` (`sessions.py:43`) and resets to `0.0` on every market switch (`sessions.py:63`, called from `reset_event_state()`).
- `scorer.whale_trades[market_id]` is a `deque(maxlen=20)` keyed by market (`scorer.py:72`) that persists across sessions and market rotations.
- On the first broadcast tick after a switch, `get_whale_trades(aid, since=0)` returns **every** entry in the deque (up to 20), regardless of how old they are or whether this client was even connected when they happened.

So switching to a market that's been watched recently replays up to 20 historical whales. The typical telltale signature — "a batch of 4 at the tick just before a rotation, then a flush of 20 at the next tick" — matches the user's log exactly.

Fix: initialise `_last_whale_check = time.time()` on pin (in `reset_event_state()` and `ClientSession.__init__`), so a fresh session only sees whales detected *during* its tenure on that market.

### 2. Whale detection prior is thin

Even with the delivery bug fixed, the detector itself is noisy:

- The gate in `_check_whale` (`scorer.py:230`) releases after only 10 trades of history. In a quiet market the first 10 trades can all be very small, producing a tiny median. Any normal-sized trade that follows registers as ≥3× and fires as a whale.
- "3×" is a fixed ratio. A market where trade sizes are naturally bimodal (lots of $1 dust + occasional $100 real trades) will fire nearly every non-dust trade as a whale by construction.
- No minimum absolute size. A $2 trade against a $0.50 median rolling baseline is technically 4×, but it's not a whale in any dollar sense.

Fix options, in order of effort:
- Raise the warmup from 10 to ~30 trades so the median is meaningful.
- Add a minimum absolute floor (e.g. ≥ $100 notional) in addition to the ratio test.
- Swap median × ratio for a percentile-based test (e.g. ≥ 95th-percentile size of the window) — more robust to bimodal distributions.

### 3. `spike` and `price_move` thresholds misuse `sens_exp`

In `server.py:331-337`:

```python
if heat_delta > EVENT_HEAT_THRESHOLD * sens_exp:
    ...
if abs_price_delta > EVENT_PRICE_THRESHOLD * sens_exp:
    ...
```

`sens_exp` (from `_sensitivity_exponent`, `server.py:105`) is a **power curve exponent**, range 0.25–4.0, used elsewhere as `value ** sens_exp` to reshape 0–1 signals. It is not a linear scalar. Multiplying a raw threshold by it is dimensionally meaningless and produces surprising behaviour:

| Sensitivity | `sens_exp` | Heat threshold | Price threshold |
| --- | --- | --- | --- |
| 0.0 (swing) | 4.0 | 0.60 heat delta | 12 ¢ delta |
| 0.5 (default) | 1.0 | 0.15 heat delta | 3 ¢ delta |
| 1.0 (scalper) | 0.25 | 0.04 heat delta | 0.75 ¢ delta |

The direction is correct (higher sensitivity → lower threshold → fires more), but the curve is 16× compressed between extremes, not a design choice — it's a coincidence of reusing the wrong variable. At sens=0.0 the thresholds are so large that `spike` effectively cannot fire; at sens=1.0 a 0.75 ¢ move fires `price_move` on nearly every tick.

Fix: use `_sensitivity_window` (or a dedicated `sens_linear` variable) for event thresholds so they scale linearly or by a chosen explicit curve, independent of the power-curve exponent.

### 4. `price_move` is both an event *and* a continuous signal

There's a related signal `price_move` in `client_payload` (computed at `server.py:350+`, median-of-endpoints over the sensitivity window, damped client-side in `audio-engine.js` `DAMPED_SIGNALS`). This continuous `price_move` is what `weather_vane` and the other tracks actually read. The **event** `price_move` is a separate, tick-to-tick diff on raw price with its own (broken, see §3) threshold.

Two things with the same name doing different jobs:
- Continuous `price_move` — smooth, edge-gated, sensitivity-windowed; drives continuous musical parameters.
- Event `price_move` — per-tick delta on raw price; drives one-shot stabs in `late_night_in_bb` and `digging_in_the_markets`.

They fire on different timescales and can disagree (e.g. a 1¢ bounce fires the event but leaves the continuous signal at zero after median-windowing). Tracks that react to both will double-trigger. The event version was added when we needed a one-shot trigger; the continuous version was added later for Weather Vane and never reconciled.

Fix: rename one of them. Easiest is to rename the event to `price_step` (per-tick) and keep continuous `price_move` for windowed behaviour. The *real* decision is whether we still need the event at all — see §7.

### 5. Whale deque is unbounded in time

`deque(maxlen=20)` bounds by count, not time. A popular market can accumulate 20 whales in minutes; a quiet one holds the same 20 whales for hours. Combined with §1, a quiet market might replay whales from a session that ended an hour ago.

Fix: drop entries older than some horizon (e.g. 60 s) in `get_whale_trades` as well as on append. With §1 fixed this is less urgent but still sensible.

### 6. Log panel is market-state, not system-state

(This is the surface symptom the user reported.) `frontend/app.js:623-626` logs every event to the visible log panel, which the user treats as a diagnostic console. Even with the above bugs fixed, the log panel would still be dominated by musical triggers during an active market. The user's stated preference: log should be for system-state (connection status, market switches, errors, audio start/stop), not market-state.

Fix: drop the four `Event:` log lines. Leave events flowing through `audioEngine.handleEvent` to tracks. Optionally add a first-data heartbeat ("price 52.3¢ — feed OK") on connect to validate the data path visually.

### 7. Whale events are effectively dead

No track currently reacts to `whale`. It costs per-client state, per-tick work, and (via §1) produces the log spam that triggered this audit, for zero audible output.

Options:
- **Remove** the whale event entirely from the server payload and the `_check_whale` detector. Simplest. Easy to re-add if a future track wants it.
- **Keep and fix** (§1 + §2 + §5). Leaves the capability available for future tracks but keeps the maintenance surface.

Neither is wrong; depends on whether we want whales as a first-class signal.

## Recommended fix order

Minimum to address the user's report:

1. Remove the four `Event:` lines from `app.js` (§6). One-line change, stops the log spam regardless of what else we do.

Incremental cleanup (in increasing scope):

2. Fix `_last_whale_check` initialisation (§1). Three-line change, prevents the underlying flood even if something reintroduces event logging later.
3. Decide on whale events: remove or harden (§7). If keeping, also do §2 and §5.
4. Fix the `sens_exp` misuse on event thresholds (§3). Independent of whales.
5. Rename event `price_move` to `price_step` and update the two consuming tracks (§4). Touches track code; do only if we're keeping the per-tick event layer.

## Files involved

- `server.py:260-348` — event detection and drain
- `sessions.py:30-65` — session state incl. `_last_whale_check`
- `market/scorer.py:60-257` — whale detection and deque
- `config.py:21-22` — event thresholds
- `frontend/app.js:619-627` — event log lines + dispatch
- `frontend/audio-engine.js:466-504` — event delivery to tracks
- `frontend/tracks/late_night_in_bb.js:721`, `digging_in_the_markets.js:493` — only current event consumers
