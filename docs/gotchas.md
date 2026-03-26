# Known Issues & Gotchas

## Environment
- **VPN required for local dev** — Polymarket blocks UAE/non-US IPs at the TLS level. Deployed EC2 in us-east-1 doesn't need VPN
- **No `tzdata` on Windows** — `zoneinfo` module requires `tzdata` package on Windows. Live finance hourly slugs use `_now_et()` which calculates ET offset manually with DST approximation instead

## Strudel / Browser Audio
- **User gesture required** — Browsers require a user interaction (click) before starting Web Audio
- **Piano samples load from CDN** — Salamander Grand Piano samples load from Strudel's BunnyCDN (`strudel.b-cdn.net`) on first init. Requires network access; browser caches after first load

## Polymarket API
- **`clobTokenIds`** from Gamma API is a JSON string, not a list — parsed by `_parse_clob_token_ids()` in `gamma.py`
- **`outcomePrices`** from Gamma API is also a JSON string — parsed by `_parse_json_string()` in `gamma.py`
- **Outcome ordering** — `asset_ids[0]` does NOT always correspond to "Yes"/"Up". Use `_primary_asset()` which checks the `outcomes` array to find the correct one
- **Gamma API prices can be stale** — For fast-moving short-duration markets, the Gamma REST API `outcomePrices` may lag behind the live price. Display uses WebSocket bid/ask midpoint as primary source
- **WebSocket raw trade prices are unreliable** — Raw trade prices spike to 0.99/0.01 on thin order books. The bid/ask midpoint is used instead
- **WebSocket first message is a list** — `_dispatch()` handles both list and dict messages
- **Event slug on nested markets** — Markets fetched via `fetch_markets_by_event_slug()` don't natively carry the parent event's slug. The function injects `event_slug` from the parent event object

## WebSocket / Multi-User
- **CloudFlare 100s idle timeout** — Server sends ping every 30s via `heartbeat` parameter in `WebSocketResponse`
- **Client auto-reconnects** — `ws-client.js` reconnects after 3s on disconnect
- **Shared subscriptions** — `SessionManager` ref-counts Polymarket WS subscriptions per asset_id. Subscribe on first watcher, could unsubscribe when last leaves (currently subscribes accumulate)

## Browse & Config
- **Browse tab tag_ids** — Hardcoded in `BROWSE_CATEGORIES` in config.py. If Polymarket changes their tag IDs, these need updating
- **Live rotation timing** — The DJ checks for expired live markets every 30s (`RESCORE_INTERVAL`). WebSocket resolution events trigger immediate rotation when available

