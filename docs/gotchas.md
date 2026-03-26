# Known Issues & Gotchas

## Environment
- **VPN required** — Polymarket blocks UAE/non-US IPs at the TLS level
- **Audio device** — scsynth outputs to Windows default audio device
- **No `tzdata` on Windows** — `zoneinfo` module requires `tzdata` package on Windows. Live finance hourly slugs use `_now_et()` which calculates ET offset manually with DST approximation instead

## Sonic Pi
- **16KB OSC packet limit** — Sonic Pi's UDP recv buffer is 16384 bytes. Track files that exceed this (with OSC overhead) are silently dropped. `run_file` strips comments automatically, but keep `.rb` files under ~14KB raw
- **Reserved names** — Sonic Pi's pre-parser forbids using built-in function names as variables. Known reserved: `range`, `tick`, `ring`, `play`, `sample`, `sleep`, `use_synth`, etc. Use alternatives (e.g., `span` instead of `range`)
- **Chord names** — Use `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7`, `:dim7`, `:aug`, `:sus2`, `:sus4`, etc. NOT `:major9`/`:minor9`/`:M9`. Check `chord.rb` in Sonic Pi install for the full list

## Polymarket API
- **`clobTokenIds`** from Gamma API is a JSON string, not a list — parsed by `_parse_clob_token_ids()` in `gamma.py`
- **`outcomePrices`** from Gamma API is also a JSON string — parsed by `_parse_json_string()` in `gamma.py`
- **Outcome ordering** — `asset_ids[0]` does NOT always correspond to "Yes"/"Up". Use `_primary_asset()` which checks the `outcomes` array to find the correct one
- **Gamma API prices can be stale** — For fast-moving short-duration markets (e.g., 15-min BTC windows), the Gamma REST API `outcomePrices` may lag behind the live price. Display uses WebSocket bid/ask midpoint as primary source, with Gamma as fallback
- **WebSocket raw trade prices are unreliable** — Raw trade prices spike to 0.99/0.01 on thin order books. The bid/ask midpoint from the order book is used instead (more stable than last trade price)
- **WebSocket first message is a list** — `_dispatch()` handles both list and dict messages
- **Event slug on nested markets** — Markets fetched via `fetch_markets_by_event_slug()` don't natively carry the parent event's slug. The function injects `event_slug` from the parent event object. Without this, live finance detection fails

## Browse & Config
- **Browse tab tag_ids** — Hardcoded in `BROWSE_CATEGORIES` in config.py. If Polymarket changes their tag IDs, these need updating. Current values: Politics=2, Sports=100639, Crypto=21, Finance=120, Culture=596, Geopolitics=100265, Tech=1401
- **Live rotation timing** — The DJ checks for expired live markets every 30s (`RESCORE_INTERVAL`). There may be up to 30s delay between market close and rotation. WebSocket resolution events trigger immediate rotation when available

## Legacy / Deprecated
- **console.py is stale** — Imports `SLOT_OSC_MAP` from `osc/bridge.py` which no longer exports it. Legacy file, not used by the main app
- **mixer/state.py and mixer/transitions.py are deprecated** — Leftover from earlier multi-layer architecture, not used by current code
