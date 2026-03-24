# Polymarket Bar — Claude Context

## What This Is

A DJ that turns Polymarket prediction market activity into generative music via Sonic Pi. Python scores markets by real-time heat, normalizes data to 0–1 ranges, and pushes raw values to Sonic Pi. Each track (.rb file) is a self-contained musical interpretation of the data — **no Python changes needed to add new tracks**.

**Repo:** https://github.com/creaseygit/polymarket_dj

## How to Run

```bash
cd C:\Github\polymarket_dj
.\venv\Scripts\activate
python server.py
# Open http://localhost:8888
# Click Start, pick a track
# Browse a category or paste a Polymarket URL to play a market
```

**Requirements:** VPN required (user is in UAE, Polymarket blocks non-US traffic). Sonic Pi must be installed at `C:\Program Files\Sonic Pi\`.

## Architecture

```
Polymarket APIs → Python (data layer) → Sonic Pi (music layer) → Audio Out
                       ↓
              Web Control Panel (localhost:8888)
```

### Data Flow
1. `polymarket/gamma.py` — REST client fetches markets by volume, category, or slug
2. `polymarket/websocket.py` — WebSocket subscribes to asset IDs, receives price changes/trades/book updates
3. `polymarket/scorer.py` — `MarketScorer` computes heat score (0-1) from price velocity, trade rate, volume, spread
4. `mixer/mixer.py` — `AutonomousDJ` picks which market to play (manual or autonomous mode). Always selects the primary (Yes/Up) outcome via `_primary_asset()`
5. `server.py` `param_push_loop` — Normalizes raw data to 0–1 and pushes to Sonic Pi every 3s
6. `sonic_pi/headless.py` — Boots Sonic Pi daemon without GUI, sends code via OSC
7. Track `.rb` files — Self-contained musical interpretations that read raw data via `get()`

### Data-Music Interface

Python pushes **raw normalized market data** to Sonic Pi every 3 seconds via `run_code` / `set`. Tracks read these values with `get()` and decide their own musical interpretation. **Python does not prescribe musical behaviour** — no per-layer params, no instrument assumptions.

#### Data Values (pushed every 3s)

| Name | Range | Source |
|------|-------|--------|
| `:heat` | 0.0 – 1.0 | Composite market activity (velocity, trade rate, volume, spread) |
| `:price` | 0.0 – 1.0 | Current price (WS bid/ask midpoint preferred, Gamma API fallback) |
| `:velocity` | 0.0 – 1.0 | Price velocity (first derivative) |
| `:trade_rate` | 0.0 – 1.0 | Trades per minute, normalized |
| `:spread` | 0.0 – 1.0 | Bid-ask spread, normalized (raw 0–0.3 → 0–1) |
| `:tone` | 0 or 1 | 1 = major (price > 0.55), 0 = minor (price < 0.45), with hysteresis |

#### Event Triggers (one-shot, reset to 0)

| Name | Values | Condition |
|------|--------|-----------|
| `:event_spike` | 0 or 1 | Heat delta > 0.15 between pushes |
| `:event_price_move` | -1, 0, +1 | Price delta > 3¢ (+1 up, -1 down) |

#### System State

| Name | Values | Meaning |
|------|--------|---------|
| `:market_resolved` | 0, 1, -1 | Market resolved (1=Yes won, -1=No won) |
| `:ambient_mode` | 0 or 1 | No active markets — ambient fallback |

### Tone Hysteresis

Tone uses hysteresis to prevent major/minor flickering when price hovers near 0.50:
- Must drop below **0.45** to switch to minor
- Must rise above **0.55** to switch to major

### Price Display
The display price uses the **WebSocket bid/ask midpoint** as the primary source (real-time, matches Polymarket's live display). Falls back to the **Gamma REST API** (`outcomePrices` field, polled every 5s via `price_poll_loop`) when WebSocket data hasn't arrived yet.

### Single Market Model
The DJ plays **one market at a time**. Two modes:
- **Manual (default):** Pick a market from browse tabs or paste a URL; it plays until you pick another
- **Autonomous:** DJ auto-switches to the hottest market when heat delta exceeds `SWAP_THRESHOLD` (0.25)

### Outcome Selection
Markets have multiple outcomes (e.g., "Yes"/"No" or "Up"/"Down"), each with its own asset_id. `_primary_asset()` in `mixer.py` always picks the "Yes" or "Up" outcome to match Polymarket's headline display.

## Key Files

| File | Purpose |
|------|---------|
| `server.py` | **Main entry point.** Web server, background loops (data push, price poll), all API handlers, full HTML UI |
| `config.py` | All tunable constants (API URLs, scoring weights, OSC config, `BROWSE_CATEGORIES`) |
| `polymarket/gamma.py` | Gamma REST API client: `fetch_active_markets`, `fetch_browse_markets`, `fetch_market_by_slug`, `fetch_markets_by_event_slug` |
| `polymarket/websocket.py` | CLOB WebSocket feed. First message is a list (book snapshot), not a dict |
| `polymarket/scorer.py` | Heat scoring: `price_velocity * 0.35 + trade_rate * 0.40 + volume * 0.15 + spread * 0.10` |
| `mixer/mixer.py` | `AutonomousDJ` — market selection, `_primary_asset()`, `_seed_prices()`, manual/autonomous modes |
| `osc/bridge.py` | OSC client wrapper, `_scale()` utility |
| `sonic_pi/headless.py` | Boots Sonic Pi daemon headlessly, manages keep-alive, sends code via `/run-code` OSC, listens for Spider errors |
| `sonic_pi/midnight_ticker.rb` | Dark electronic track — reference implementation of the data interface |

## How Sonic Pi Integration Works

The headless launcher (`sonic_pi/headless.py`):
1. Finds Ruby + daemon.rb in Sonic Pi install dir
2. Runs `daemon.rb` which spawns `scsynth` + Spider server + Tau
3. Reads port allocations from daemon stdout (8 values: daemon, gui-listen, gui-send, scsynth, osc-cues, tau-api, tau-phx, token)
4. Sends `/daemon/keep-alive` with token every 2s
5. Sends `/run-code [token, code]` to Spider to execute .rb code
6. Listens on `gui_listen_port` for `/error` and `/syntax_error` messages from Spider (printed to console as `[SONIC PI ERROR]`)

**Critical:** Data is pushed via `run_code` (e.g., `set :heat, 0.65`) NOT just OSC messages. Tracks read values with `get(:heat)` in their loops. OSC `sync` listeners exist but are unreliable for parameter updates.

**Critical: 16KB OSC limit.** Sonic Pi's Spider server uses `recvfrom(16384)` — track `.rb` files must produce OSC packets under 16KB. The `run_file` method strips comment-only lines and blank lines before sending to stay within this limit. Keep tracks concise; avoid verbose comments in `.rb` files.

**Orphan cleanup:** Previous headless instances can leave `scsynth.exe` and `ruby.exe` running. The web UI has a "Kill All" button. The `atexit` handler in `headless.py` also cleans up.

## Writing New Tracks

New `.rb` files in `sonic_pi/` are auto-discovered by the web UI. A track must:

1. **Set defaults** so the track plays immediately without market data:
```ruby
set :heat, 0.4
set :price, 0.5
set :velocity, 0.2
set :trade_rate, 0.3
set :spread, 0.2
set :tone, 1
set :event_spike, 0
set :event_price_move, 0
set :market_resolved, 0
set :ambient_mode, 0
```

2. **Read raw data** with `get(:heat)`, `get(:price)`, etc. in live_loops. Python pushes new values every 3s via `run_code`/`set` — they take effect on next `get()`.

3. **Map data to music however you want.** The track is the artist's canvas:
   - Any number of instruments/layers
   - Any mapping logic (heat → volume, price → pitch, trade_rate → rhythm density, etc.)
   - Any genre, any structure

4. **Keep amp values conservative** — use `set_volume! 0.7` for master headroom, keep individual amps under 0.5

5. **Keep the file concise** — under ~14KB raw. `run_file` strips comments automatically, but stay within budget

6. **Do not use Sonic Pi reserved names as variables** — e.g., `range`, `tick`, `ring`, `play`, `sample`, `sleep`

7. **Use correct chord names** — `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7` (NOT `:major9`, `:minor9`, `:M9`)

See `midnight_ticker.rb` for the reference implementation.

## Background Loops

| Loop | Interval | Purpose |
|------|----------|---------|
| `param_push_loop` | 3s | Push raw normalized market data + event triggers to Sonic Pi via `run_code` |
| `price_poll_loop` | 5s | Fetch current market's API price from Gamma (fallback, uses `asyncio.to_thread`) |
| `dj_loop` / `_refresh_markets` | 30s | Re-fetch top 50 markets, update scorer volumes, seed prices |
| WebSocket feed | Real-time | Price changes, trades, book updates → scorer |
| UI status poll | 1.5s | Browser polls `/api/status` to update Now Playing + controls |

## Web UI Structure

The UI has four sections:
1. **Audio** — Start/Stop, track selector, test sounds, Kill All
2. **Now Playing** — Current market question, bullish/bearish + price %, raw data values, link to Polymarket
3. **Mode + Feed** — Manual/Autonomous toggle, WebSocket connection status
4. **Markets** — URL paste input, "Your Markets" (session list), Browse tabs (Trending, Politics, Sports, Crypto, Finance, Culture, Geopolitics, Tech, Closing Soon)

### Browse Tabs
Each tab fetches 10 markets from the Gamma API filtered by `tag_id` (defined in `BROWSE_CATEGORIES` in config.py). Results are cached client-side per tab. "Trending" = all markets sorted by volume. "Closing Soon" = sorted by end_date ascending. Clicking "Play" on a browse result fetches the market via `/api/play-url`, injects it into the DJ, and adds it to "Your Markets".

### Your Markets
A session-only list (JS array, not persisted) of markets the user has played. Clicking replays via `/api/pin`. Cleared with the "Clear" button.

## Known Issues / Gotchas

- **VPN required** — Polymarket blocks UAE/non-US IPs at the TLS level
- **16KB OSC packet limit** — Sonic Pi's UDP recv buffer is 16384 bytes. Track files that exceed this (with OSC overhead) are silently dropped. `run_file` strips comments automatically, but keep `.rb` files under ~14KB raw
- **Sonic Pi reserved names** — Sonic Pi's pre-parser forbids using built-in function names as variables. Known reserved: `range`, `tick`, `ring`, `play`, `sample`, `sleep`, `use_synth`, etc. Use alternatives (e.g., `span` instead of `range`)
- **Sonic Pi chord names** — Use `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7`, `:dim7`, `:aug`, `:sus2`, `:sus4`, etc. NOT `:major9`/`:minor9`/`:M9`. Check `chord.rb` in Sonic Pi install for the full list
- **`clobTokenIds`** from Gamma API is a JSON string, not a list — parsed by `_parse_clob_token_ids()` in `gamma.py`
- **`outcomePrices`** from Gamma API is also a JSON string — parsed by `_parse_json_string()` in `gamma.py`
- **Outcome ordering** — `asset_ids[0]` does NOT always correspond to "Yes"/"Up". Use `_primary_asset()` which checks the `outcomes` array to find the correct one
- **Gamma API prices can be stale** — For fast-moving short-duration markets (e.g., 15-min BTC windows), the Gamma REST API `outcomePrices` may lag behind the live price. Display now uses WebSocket bid/ask midpoint as primary source, with Gamma as fallback
- **WebSocket raw trade prices are unreliable** — Raw trade prices spike to 0.99/0.01 on thin order books. The bid/ask midpoint from the order book is used instead (more stable than last trade price)
- **WebSocket first message is a list** — `_dispatch()` handles both list and dict messages
- **Audio device** — scsynth outputs to Windows default audio device
- **Headless error visibility** — Spider errors are now captured via a UDP listener on `gui_listen_port` and printed to the server console as `[SONIC PI ERROR]`. Without this, errors are silently swallowed in headless mode. Noisy messages (`/incoming/osc`, `/log/info`) are filtered out
- **Console log tags** — `[DATA]` = raw data state every 3s, `[PRICE POLL]` = Gamma API poll every 5s, `[EVENT]` = heat spike or price move detected, `[DJ]` = market switch/selection
- **Browse tab tag_ids** — Hardcoded in `BROWSE_CATEGORIES` in config.py. If Polymarket changes their tag IDs, these need updating. Current values: Politics=2, Sports=100639, Crypto=21, Finance=120, Culture=596, Geopolitics=100265, Tech=1401

## Web API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Current state: audio, feed, mode, current market + price + raw data values |
| POST | `/api/start` | Boot Sonic Pi, load track. Body: `{"track": "midnight_ticker"}` |
| POST | `/api/stop` | Stop audio gracefully |
| POST | `/api/test-sound` | Test audio. Body: `{"type": "beep"|"kick"|"all_layers"}` |
| POST | `/api/track` | Switch track. Body: `{"track": "midnight_ticker"}` |
| POST | `/api/pin` | Play specific market already in DJ's list. Body: `{"slug": "..."}` |
| POST | `/api/play-url` | Play from Polymarket URL (fetches + injects + pins). Body: `{"url": "..."}` |
| POST | `/api/unpin` | Clear pin (stays on current market in manual mode) |
| POST | `/api/autonomous` | Toggle mode. Body: `{"enabled": true|false}` |
| POST | `/api/kill-all` | Kill all scsynth.exe and ruby.exe processes |
| GET | `/api/browse` | Browse markets by category. Params: `tag_id`, `sort` (volume\|closing), `limit` |
| GET | `/api/categories` | Returns list of browse tab definitions from `BROWSE_CATEGORIES` |

## Tech Stack

- Python 3.12, asyncio (WindowsSelectorEventLoopPolicy on Windows)
- aiohttp (web server)
- python-osc (OSC messaging)
- websockets (Polymarket CLOB feed)
- requests (Gamma REST API)
- Sonic Pi 4.6 (Ruby 3.4.4 + SuperCollider scsynth 3.13.0, runs headless)
