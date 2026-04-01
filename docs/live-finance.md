# Live Finance Markets (Auto-Rotation)

The prediction market has auto-generated rolling markets for BTC/ETH price movement with fixed time windows (5m, 15m, hourly). These rotate constantly — each window gets a new event with a timestamp-based or date-based slug.

## How It Works

1. **Timestamp-based (5m, 15m):** `LIVE_FINANCE_PATTERNS` in `gamma.py` defines patterns: `btc-updown-5m`, `btc-updown-15m`, `eth-updown-5m`, `eth-updown-15m`. Slugs use Unix timestamps (e.g. `btc-updown-15m-1774424700`)
2. **Hourly date-based:** `LIVE_HOURLY_PATTERNS` defines patterns: `bitcoin-up-or-down`. Slugs use ET date+hour (e.g. `bitcoin-up-or-down-march-25-2026-3am-et`, `bitcoin-up-or-down-march-25-2026-1pm-et`). Built by `_hourly_slug()` using 12-hour format with am/pm suffix
3. `fetch_live_finance_markets()` computes the current window boundary from the system clock and tries current + next window slugs for both pattern types
4. Hourly slugs use `_now_et()` which calculates US Eastern time with DST (no `tzdata` dependency — uses manual DST calculation for Windows compatibility)
5. The "Crypto Live" browse tab (`tag_id: "live"`) calls this function. Results are never cached client-side since they rotate
6. Users can also paste hourly URLs directly (e.g. `https://polymarket.com/event/bitcoin-up-or-down-march-25-2026-1am-et`) — auto-rotation works the same way

## Auto-Rotation (Per-Session)

Rotation is driven per-client-session in `server.py`, not by the DJ's global state. This is because each browser client independently selects its own market via `_pin_market_for_session()`.

- `_check_live_rotations()` runs every ~30s from the broadcast loop, iterates all sessions
- For each session watching a live finance market, compares `end_date` against UTC now
- Console shows `[LIVE:<client_id>] <event_slug> ends in 1m23s` countdown when <2min remain
- When `end_date` passes, `_rotate_session_to_next_live()` fetches the next window's market matching the same prefix pattern (e.g. stays on 15m if you started on 15m, stays on hourly if you started on hourly)
- Prefix extraction strips the timestamp or date suffix to find the base pattern (e.g. `bitcoin-up-or-down-march-25-2026-1am-et` → `bitcoin-up-or-down`)
- On WebSocket resolution event, `_handle_resolution_for_sessions()` triggers immediate rotation for affected sessions without waiting for the 30s cycle
- `_LIVE_SLUG_RE` regex (in `mixer.py`) identifies live finance markets by event_slug pattern: matches both `(btc|eth)-updown-\d+m-\d+` and `bitcoin-up-or-down-*-et`
- The DJ also has its own `_check_live_rotation()` / `_rotate_live_market()` methods, but these operate on `dj.current_market` which is not set by per-client market selection — the server-level functions are what drive actual rotation

## Event Slug Injection

Markets fetched via `fetch_markets_by_event_slug()` have the parent event's slug injected into each nested market's `event_slug` field. Without this, the live finance detection regex can't match (nested markets from the events API don't carry their parent event slug natively).
