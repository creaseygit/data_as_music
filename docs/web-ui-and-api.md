# Web UI & API

## Main Page (localhost:8888)

The UI has four sections:

1. **Audio** — Single Play/Stop toggle (hidden until a market is selected; auto-starts on market pick), track selector, volume slider (client-side), sensitivity slider (server-side), connection status
2. **Now Playing** — Current market question (ET times converted to user's local timezone), bullish/bearish + price %, raw data values (heat, velocity, trade rate, spread), link to market
3. **Connection** — WebSocket connection status (auto-reconnects)
4. **Data Source** — URL paste input, Browse tabs (Trending, Crypto Live, Politics, Sports, Crypto, Finance, Culture, Geopolitics, Tech, Closing Soon)

## Multi-User Model

Each browser client gets an independent session:
- Own market selection (pin/URL)
- Own sensitivity setting
- Own track choice and volume (volume is client-side only)
- Own event detection state (tone hysteresis, spike/price_move thresholds)

The server maintains shared market WebSocket subscriptions via reference counting in `SessionManager`. If 50 users watch BTC, only 1 market subscription exists.

## WebSocket Protocol (`/ws`)

**Server → Client:**

| type | payload | when |
|------|---------|------|
| `status` | `{tracks: [...], categories: [...]}` | On connect |
| `market_data` | `{heat, price, price_moving, price_delta_band, price_delta_cents, price_move, momentum, velocity, volatility, trade_rate, spread, tone, sensitivity, window_seconds, window_fill, warmup_factor, ticks_since_rotation}` | Every 3s. See `docs/data-interface.md` for field semantics. |
| `event` | `{event: "spike"\|"price_step"\|"resolved", direction?, result?}` | On threshold. `price_step` is the per-tick raw price jump; distinct from the continuous `price_move` signal in `market_data`. |
| `market_info` | `{question, slug, event_slug, outcomes, link}` | On market change |
| `error` | `{message: "..."}` | On error |

**Client → Server:**

| action | params | purpose |
|--------|--------|---------|
| `pin` | `{slug}` | Pin a market |
| `play_url` | `{url}` | Play from market URL |
| `unpin` | — | Clear pinned market |
| `sensitivity` | `{value: 0.0-1.0}` | Set sensitivity |
| `track` | `{name}` | Set track name |

## HTTP API Endpoints (stateless)

| Method | Path             | Purpose                                                             |
| ------ | ---------------- | ------------------------------------------------------------------- |
| GET    | `/`              | Serve main page (`frontend/index.html`)                             |
| GET    | `/sandbox`       | Sandbox & Mastering page (`frontend/sandbox.html`)                  |
| GET    | `/master`        | Redirects to `/sandbox`                                              |
| GET    | `/ws`            | WebSocket endpoint                                                   |
| GET    | `/api/browse`    | Browse markets by category. Params: `tag_id`, `sort`, `limit`       |
| GET    | `/api/categories`| Returns list of browse tab definitions from `BROWSE_CATEGORIES`     |
| GET    | `/static/*`      | Static files from `frontend/` directory                              |

## Sandbox & Mastering Page (`/sandbox`)

Combined sandbox and mastering page — simulated market data exploration with per-voice gain mixing. No live market connection needed. Makes a brief WebSocket connection on load solely to fetch the track list, then disconnects. `/master` redirects here.

- **Data signal sliders** — all 9 signals (heat, price, price_move, momentum, velocity, trade_rate, spread, volatility, sensitivity) plus tone toggle. Changes push synthetic data directly to `audioEngine.onMarketData()`
- **Presets** — 6 named presets that set all sliders at once: Bull Run, Crash, Dead Market, Chaos, Breakout, Calm Trend
- **Sweeps** — animate a single signal (or all) from 0→1 over a configurable duration via `requestAnimationFrame`
- **Event triggers** — fire synthetic events (spike, price_move +/-, resolved yes/no) with adjustable magnitude
- **Per-voice gain sliders** — range 0.00–2.00 (0=muted, 1=original, 2=boosted). Reads `track.voices` to render sliders, writes to `track.gains`. Changes take effect at next cycle boundary
- **Solo (S) / Mute (M)** — UI-only state (not exported). Solo = only soloed voices play. Mute = silence that voice. Implemented by overriding `track.getGain()` to return 0 for muted/un-soloed voices
- **Master volume** — Web Audio GainNode
- **Export JSON** — downloads `{format: "dam.fm/mastering", version: 1, track, timestamp, voices: {id: gain}}`
- **Import JSON** — loads gains from file, applies to matching voice IDs, warns on track name mismatch
- **Voice gain sliders** — same per-voice gain/solo/mute as mastering page, plus JSON export/import

## Browse Tabs

Each tab fetches 10 markets from the Gamma API filtered by `tag_id` (defined in `BROWSE_CATEGORIES` in config.py). Results are cached client-side per tab (except "Crypto Live" which always fetches fresh). "Trending" = all markets sorted by volume. "Closing Soon" = sorted by end_date ascending. "Crypto Live" = calls `fetch_live_finance_markets()`.

## Background Loops

| Loop                           | Interval  | Purpose                                                                          |
| ------------------------------ | --------- | -------------------------------------------------------------------------------- |
| `broadcast_loop`               | 3s        | Per-client: compute sensitivity-adjusted data, detect events, push via WebSocket |
| `price_poll_loop`              | 5s        | Fetch API prices for all watched markets (fallback, uses `asyncio.to_thread`)    |
| `dj_loop` / `_refresh_markets` | 30s       | Re-fetch top 50 markets, update scorer volumes, seed prices, check live rotation |
| Market WebSocket feed          | Real-time | Price changes, trades, book updates → scorer                                     |

## Deployment

- **Lightsail** $5/mo plan (1GB RAM, 1 vCPU) in us-east-1 (eliminates VPN requirement, includes 2TB data transfer)
- **Nginx** reverse proxy: serves `frontend/` as static files, proxies `/ws` (with WebSocket upgrade) and `/api/*` to Python on port 8888
  - Rate limiting on `/api/` — 5 req/s per IP, burst 10 (`limit_req_zone`)
  - Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`
- **CloudFlare** for DNS, CDN (caches static assets), HTTPS (Full strict), WebSocket support
- **systemd** service runs as dedicated `data-as-music` user
- Server sends WebSocket ping every 30s (CloudFlare has 100s idle timeout)
- Config files in `deploy/`: `nginx.conf`, `data-as-music.service`, `setup.sh`

## Console Log Tags

| Tag              | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `[FEED]`         | Market WebSocket feed lifecycle                                       |
| `[PRICE POLL]`   | Gamma API price poll every 5s                                         |
| `[BROWSE]`       | Browse API errors (logged server-side, generic message sent to client) |
| `[PLAY_URL]`     | Play-URL errors (logged server-side, generic message sent to client)   |
| `[BROADCAST]`    | Per-client data push errors                                           |
| `[DJ]`           | Market switch/selection                                               |
| `[LIVE]`         | Live finance rotation: countdown, rotation triggers, pattern matching |
| `[RESOLVED]`     | Market resolution event from WebSocket                                |
| `[WS:clientid]`  | Per-client WebSocket connection/action logs                           |
| `[SERVER]`       | Web server lifecycle                                                  |
