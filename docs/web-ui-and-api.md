# Web UI & API

## Main Page (localhost:8888)

The UI has four sections:

1. **Audio** — Start/Stop, track selector, volume control, test sounds, Kill All, link to Track Sandbox
2. **Now Playing** — Current market question, bullish/bearish + price %, raw data values (heat, velocity, trade rate, spread), link to Polymarket
3. **Feed** — WebSocket connection status
4. **Markets** — URL paste input, "Your Markets" (session list), Browse tabs (Trending, Crypto Live, Politics, Sports, Crypto, Finance, Culture, Geopolitics, Tech, Closing Soon)

## Track Sandbox (localhost:8888/sandbox)

A development tool for testing tracks without live market data:

- Track selection + Start/Stop (boots Sonic Pi in sandbox mode — no market data push)
- Manual sliders for all data values: heat, price, velocity, trade_rate, spread (0–1)
- Toggle buttons for tone (major/minor) and ambient mode
- One-shot event buttons: heat spike, price up, price down, resolved yes, resolved no
- **Track Analyzer**: Parses .rb file with regex, shows each `live_loop` and which `get(:param)` calls it reads. Visualizes the instrument-to-data mapping

## Browse Tabs

Each tab fetches 10 markets from the Gamma API filtered by `tag_id` (defined in `BROWSE_CATEGORIES` in config.py). Results are cached client-side per tab (except "Crypto Live" which always fetches fresh). "Trending" = all markets sorted by volume. "Closing Soon" = sorted by end_date ascending. "Crypto Live" = calls `fetch_live_finance_markets()` to find current rolling BTC/ETH windows. Clicking "Play" on a browse result fetches the market via `/api/play-url`, injects it into the DJ, and adds it to "Your Markets".

## Your Markets

A session-only list (JS array, not persisted) of markets the user has played. Clicking replays via `/api/pin`. Cleared with the "Clear" button.

## API Endpoints

| Method | Path                 | Purpose                                                                                |
| ------ | -------------------- | -------------------------------------------------------------------------------------- |
| GET    | `/api/status`        | Current state: audio, feed, current market + price + raw data values                   |
| POST   | `/api/start`         | Boot Sonic Pi, load track. Body: `{"track": "midnight_ticker"}`                        |
| POST   | `/api/stop`          | Stop audio gracefully                                                                  |
| POST   | `/api/test-sound`    | Test audio. Body: `{"type": "beep" \| "kick" \| "all_layers"}`                        |
| POST   | `/api/track`         | Switch track. Body: `{"track": "midnight_ticker"}`                                     |
| POST   | `/api/volume`        | Set master volume. Body: `{"volume": 0.7}`                                             |
| POST   | `/api/pin`           | Play specific market already in DJ's list. Body: `{"slug": "..."}`                     |
| POST   | `/api/play-url`      | Play from Polymarket URL (fetches + injects + pins). Body: `{"url": "..."}`            |
| POST   | `/api/unpin`         | Clear pin (stays on current market)                                                    |
| POST   | `/api/kill-all`      | Kill all scsynth.exe and ruby.exe processes                                            |
| GET    | `/api/browse`        | Browse markets by category. Params: `tag_id`, `sort` (volume\|closing), `limit`        |
| GET    | `/api/categories`    | Returns list of browse tab definitions from `BROWSE_CATEGORIES`                        |
| GET    | `/api/track/analyze` | Parse .rb file, return live_loops + data params each reads. Params: `track`            |
| GET    | `/sandbox`           | Track Sandbox page                                                                     |
| POST   | `/api/sandbox/start` | Boot Sonic Pi in sandbox mode (no market data). Body: `{"track": "..."}`               |
| POST   | `/api/sandbox/stop`  | Stop sandbox mode                                                                      |
| POST   | `/api/sandbox/push`  | Push manual data values. Body: `{"heat": 0.5, "price": 0.6, ...}`                     |

## Background Loops

| Loop                           | Interval  | Purpose                                                                          |
| ------------------------------ | --------- | -------------------------------------------------------------------------------- |
| `param_push_loop`              | 3s        | Push raw normalized market data + event triggers to Sonic Pi via `run_code`      |
| `price_poll_loop`              | 5s        | Fetch current market's API price from Gamma (fallback, uses `asyncio.to_thread`) |
| `dj_loop` / `_refresh_markets` | 30s       | Re-fetch top 50 markets, update scorer volumes, seed prices, check live rotation |
| WebSocket feed                 | Real-time | Price changes, trades, book updates → scorer                                     |
| UI status poll                 | 1.5s      | Browser polls `/api/status` to update Now Playing + controls                     |

## Console Log Tags

| Tag                | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `[DATA]`           | Raw data state pushed to Sonic Pi every 3s                            |
| `[PRICE POLL]`     | Gamma API price poll every 5s                                         |
| `[EVENT]`          | Heat spike or price move detected                                     |
| `[DJ]`             | Market switch/selection                                               |
| `[LIVE]`           | Live finance rotation: countdown, rotation triggers, pattern matching |
| `[RESOLVED]`       | Market resolution event from WebSocket                                |
| `[SONIC PI]`       | Code sent to Sonic Pi                                                 |
| `[SONIC PI ERROR]` | Error from Sonic Pi Spider server                                     |
| `[SERVER]`         | Web server lifecycle                                                  |
