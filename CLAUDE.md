# Polymarket Bar — Claude Context

## What This Is

A DJ that turns Polymarket prediction market activity into generative music via Sonic Pi. Python scores markets by real-time heat, maps data to musical parameters, and drives a Sonic Pi track headlessly. A web control panel at `http://localhost:8888` lets users browse markets by category, paste Polymarket URLs, and control playback.

**Repo:** https://github.com/creaseygit/polymarket_dj

## How to Run

```bash
cd C:\Github\polymarket_dj
.\venv\Scripts\activate
python server.py
# Open http://localhost:8888
# Click Start, pick a track (market_pulse_v3 recommended)
# Browse a category or paste a Polymarket URL to play a market
```

**Requirements:** VPN required (user is in UAE, Polymarket blocks non-US traffic). Sonic Pi must be installed at `C:\Program Files\Sonic Pi\`.

## Architecture

```
Polymarket APIs → Python Brain → Sonic Pi (headless) → Audio Out
                       ↓
              Web Control Panel (localhost:8888)
```

### Data Flow
1. `polymarket/gamma.py` — REST client fetches markets by volume, category, or slug. Also provides browse-by-category and live finance market discovery
2. `polymarket/websocket.py` — WebSocket subscribes to asset IDs, receives price changes/trades/book updates
3. `polymarket/scorer.py` — `MarketScorer` computes heat score (0-1) from price velocity, trade rate, volume, spread
4. `mixer/mixer.py` — `AutonomousDJ` picks which market drives the song (manual or autonomous mode). Always selects the primary (Yes/Up) outcome via `_primary_asset()`
5. `osc/bridge.py` — Maps heat/price/velocity/spread to musical params (amp, cutoff, reverb, density, tone, tension, swing)
6. `sonic_pi/headless.py` — Boots Sonic Pi daemon without GUI, sends code via OSC
7. Params pushed to Sonic Pi via `run_code` (direct `set`) every 3 seconds

### Price Display
The display price uses the **WebSocket bid/ask midpoint** as the primary source (real-time, matches Polymarket's live display). Falls back to the **Gamma REST API** (`outcomePrices` field, polled every 5s via `price_poll_loop`) when WebSocket data hasn't arrived yet. The Gamma API can be stale on fast-moving short-duration markets (e.g., 15-minute BTC windows), so the WebSocket midpoint is preferred when available.

### Single Market Model
The DJ plays **one market at a time**. All 5 instrument layers (kick, bass, pad, lead, atmosphere) respond to the same market but with **per-layer parameter differentiation** — each layer receives different amp multipliers, cutoff offsets, and density curves (see Per-Layer Differentiation below). Two modes:
- **Manual (default):** Pick a market from browse tabs or paste a URL; it plays until you pick another
- **Autonomous:** DJ auto-switches to the hottest market when heat delta exceeds `SWAP_THRESHOLD` (0.25)

### Outcome Selection
Markets have multiple outcomes (e.g., "Yes"/"No" or "Up"/"Down"), each with its own asset_id. `_primary_asset()` in `mixer.py` always picks the "Yes" or "Up" outcome to match Polymarket's headline display. The `outcome_prices` and `outcomes` arrays from the API are stored on each market dict and kept in sync.

## Key Files

| File | Purpose |
|------|---------|
| `server.py` | **Main entry point.** Web server, background loops (param push, price poll), all API handlers, full HTML UI |
| `config.py` | All tunable constants (API URLs, scoring weights, OSC config, `BROWSE_CATEGORIES`) |
| `polymarket/gamma.py` | Gamma REST API client: `fetch_active_markets`, `fetch_browse_markets`, `fetch_market_by_slug`, `fetch_markets_by_event_slug`, `fetch_live_finance_markets` |
| `polymarket/websocket.py` | CLOB WebSocket feed. First message is a list (book snapshot), not a dict |
| `polymarket/scorer.py` | Heat scoring: `price_velocity * 0.35 + trade_rate * 0.40 + volume * 0.15 + spread * 0.10` |
| `mixer/mixer.py` | `AutonomousDJ` — market selection, `_primary_asset()`, `_seed_prices()`, manual/autonomous modes |
| `osc/bridge.py` | Market data → musical parameter mapping. Amp capped at 0.8 to prevent clipping |
| `sonic_pi/headless.py` | Boots Sonic Pi daemon headlessly, manages keep-alive, sends code via `/run-code` OSC, listens for Spider errors |
| `sonic_pi/market_pulse_v2.rb` | Legacy track. TB303 acid bass, layered pads, stepwise lead, slicer atmos, probabilistic hats |
| `sonic_pi/market_pulse_v3.rb` | **Best track.** Per-layer differentiation, 32-bar structural cycle, swing, snare + sub-bass layers, event stingers, polyrhythmic percussion |

## How Sonic Pi Integration Works

The headless launcher (`sonic_pi/headless.py`):
1. Finds Ruby + daemon.rb in Sonic Pi install dir
2. Runs `daemon.rb` which spawns `scsynth` + Spider server + Tau
3. Reads port allocations from daemon stdout (8 values: daemon, gui-listen, gui-send, scsynth, osc-cues, tau-api, tau-phx, token)
4. Sends `/daemon/keep-alive` with token every 2s
5. Sends `/run-code [token, code]` to Spider to execute .rb code
6. Listens on `gui_listen_port` for `/error` and `/syntax_error` messages from Spider (printed to console as `[SONIC PI ERROR]`)

**Critical:** Params are pushed via `run_code` (e.g., `set :kick_amp, 0.7`) NOT just OSC messages. The tracks read params with `get(:kick_amp)` in their loops. OSC `sync` listeners exist but are unreliable for parameter updates.

**Critical: 16KB OSC limit.** Sonic Pi's Spider server uses `recvfrom(16384)` — track `.rb` files must produce OSC packets under 16KB. The `run_file` method strips comment-only lines and blank lines before sending to stay within this limit. Keep tracks concise; avoid verbose comments in `.rb` files.

**Orphan cleanup:** Previous headless instances can leave `scsynth.exe` and `ruby.exe` running. The web UI has a "Kill All" button. The `atexit` handler in `headless.py` also cleans up.

## Musical Parameter Mapping

Base values computed from market data, then differentiated per layer:

| Market Signal | Musical Param | Range |
|--------------|---------------|-------|
| Heat score (composite) | amp | 0.1 – 0.8 |
| WS midpoint price (Yes/Up outcome) | cutoff | 60 – 115 |
| Price velocity | reverb | 0.1 – 0.85 |
| Trade rate/min | density | 0.1 – 1.0 |
| Price with hysteresis (0.45/0.55 thresholds) | tone | 1 (major) / 0 (minor) |
| Bid-ask spread | tension | 0.0 – 1.0 |
| Tension × 0.06 | swing | 0.0 – 0.06 |

### Per-Layer Differentiation

Each layer receives modified versions of the base params (`param_push_loop` in `server.py`):

| Layer | Amp | Cutoff | Reverb | Density | Swing | Notes |
|-------|-----|--------|--------|---------|-------|-------|
| **kick** | ×1.0 | −20 | ×0.3 (dry) | direct | from tension | — |
| **bass** | ×0.9 | −15 | ×0.2 (driest) | direct | none | — |
| **pad** | 0.3–0.7 (always present) | full | ×1.3 (wet) | **inverse** | none | Quiet markets = open pad |
| **lead** | ×0.8 (gated off below density 0.3) | +10 | full | offset −0.15 | none | Threshold gate |
| **atmos** | ×0.5 | **EMA smoothed** | ×1.5 (wettest) | **EMA smoothed** | none | Slow-reacting |

### Event Detection

Python detects market events and pushes one-shot triggers to Sonic Pi:
- **Heat spike** (delta > 0.15): `set :event_spike, 1` → crash cymbal + pentatonic stab
- **Price move** (delta > 3¢): `set :event_price_move, ±1` → ascending (up) or descending (down) arpeggio

### Tone Hysteresis

Tone uses hysteresis to prevent major/minor flickering when price hovers near 0.50:
- Must drop below **0.45** to switch to minor
- Must rise above **0.55** to switch to major

## Background Loops

| Loop | Interval | Purpose |
|------|----------|---------|
| `param_push_loop` | 3s | Push per-layer differentiated params + event triggers to Sonic Pi via `run_code` + OSC |
| `price_poll_loop` | 5s | Fetch current market's API price from Gamma (fallback, uses `asyncio.to_thread`) |
| `dj_loop` / `_refresh_markets` | 30s | Re-fetch top 50 markets, update scorer volumes, seed prices |
| WebSocket feed | Real-time | Price changes, trades, book updates → scorer |
| UI status poll | 1.5s | Browser polls `/api/status` to update Now Playing + controls |

## Web UI Structure

The UI has four sections:
1. **Audio** — Start/Stop, track selector, test sounds, Kill All
2. **Now Playing** — Current market question, bullish/bearish + price %, OSC params, link to Polymarket
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
- **Amp was causing distortion** — Fixed by capping at 0.8 (was 1.4). The `_scale` in `osc/bridge.py` and `server.py` must stay in sync
- **`clobTokenIds`** from Gamma API is a JSON string, not a list — parsed by `_parse_clob_token_ids()` in `gamma.py`
- **`outcomePrices`** from Gamma API is also a JSON string — parsed by `_parse_json_string()` in `gamma.py`
- **Outcome ordering** — `asset_ids[0]` does NOT always correspond to "Yes"/"Up". Use `_primary_asset()` which checks the `outcomes` array to find the correct one
- **Gamma API prices can be stale** — For fast-moving short-duration markets (e.g., 15-min BTC windows), the Gamma REST API `outcomePrices` may lag behind the live price. Display now uses WebSocket bid/ask midpoint as primary source, with Gamma as fallback
- **WebSocket raw trade prices are unreliable** — Raw trade prices spike to 0.99/0.01 on thin order books. The bid/ask midpoint from the order book is used instead (more stable than last trade price)
- **WebSocket first message is a list** — `_dispatch()` handles both list and dict messages
- **Audio device** — scsynth outputs to Windows default audio device
- **Headless error visibility** — Spider errors are now captured via a UDP listener on `gui_listen_port` and printed to the server console as `[SONIC PI ERROR]`. Without this, errors are silently swallowed in headless mode. Noisy messages (`/incoming/osc`, `/log/info`) are filtered out
- **Console log tags** — `[PARAMS]` = data state every 3s, `[PRICE POLL]` = Gamma API poll every 5s, `[EVENT]` = heat spike or price move detected, `[DJ]` = market switch/selection
- **Browse tab tag_ids** — Hardcoded in `BROWSE_CATEGORIES` in config.py. If Polymarket changes their tag IDs, these need updating. Current values: Politics=2, Sports=100639, Crypto=21, Finance=120, Culture=596, Geopolitics=100265, Tech=1401

## Web API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Current state: audio, feed, mode, current market + price + OSC params |
| POST | `/api/start` | Boot Sonic Pi, load track. Body: `{"track": "market_pulse_v2"}` |
| POST | `/api/stop` | Stop audio gracefully |
| POST | `/api/test-sound` | Test audio. Body: `{"type": "beep"|"kick"|"all_layers"}` |
| POST | `/api/track` | Switch track. Body: `{"track": "market_pulse_v2"}` |
| POST | `/api/pin` | Play specific market already in DJ's list. Body: `{"slug": "..."}` |
| POST | `/api/play-url` | Play from Polymarket URL (fetches + injects + pins). Body: `{"url": "..."}` |
| POST | `/api/unpin` | Clear pin (stays on current market in manual mode) |
| POST | `/api/autonomous` | Toggle mode. Body: `{"enabled": true|false}` |
| POST | `/api/kill-all` | Kill all scsynth.exe and ruby.exe processes |
| GET | `/api/browse` | Browse markets by category. Params: `tag_id`, `sort` (volume\|closing), `limit` |
| GET | `/api/categories` | Returns list of browse tab definitions from `BROWSE_CATEGORIES` |

## Writing New Tracks

New `.rb` files in `sonic_pi/` are auto-discovered by the web UI. A track must:

1. Initialize layer state with audible defaults (so the track plays immediately even without market data):
```ruby
[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  set :"#{layer}_amp",     0.4
  set :"#{layer}_cutoff",  80.0
  set :"#{layer}_reverb",  0.3
  set :"#{layer}_density", 0.5
  set :"#{layer}_tone",    1
  set :"#{layer}_tension", 0.0
  set :"#{layer}_swing",   0.0
end
set :event_spike, 0
set :event_price_move, 0
```

2. Use `get(:kick_amp)` etc. in live_loops to read params (NOT `sync` for params — Python pushes via `run_code`/`set`)

3. Keep individual amp values conservative (multiply `get(:kick_amp)` by 0.1-0.7 per element)

4. Use HPF on non-bass elements, keep bass centered, spread others in stereo

5. Use `set_volume! 0.7` for master headroom

6. **Keep the file concise** — strip verbose comments. The OSC packet (file + ~28 bytes overhead) must stay under 16384 bytes. `run_file` strips comment-only lines automatically, but raw file size should stay under ~14KB

7. **Do not use Sonic Pi reserved names as variables** — e.g., `range`, `tick`, `ring`, `play`, `sample`, `sleep`

8. **Use correct chord names** — `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7` (NOT `:major9`, `:minor9`, `:M9`)

See `market_pulse_v3.rb` for the reference implementation.

### market_pulse_v3 Structure

The v3 track adds:
- **32-bar structural cycle** via `live_loop :bar_clock` — bars 0–23 normal, 24–27 breakdown (kick drops, sparse lead, sub-only bass), 28–31 build (accelerating kicks, snare rolls)
- **Snare layer** — beats 2 & 4 with ghost notes, sample variation, flams on tense markets
- **Sub-bass** — pure `:sine` an octave below TB303, always present, louder during breakdowns
- **Polyrhythmic percussion** — 3-over-4 bell pattern at higher densities
- **Swing** — hats and kick offset by `get(:kick_swing)` on off-beats
- **Event responder** — `live_loop :event_responder` checks `:event_spike` and `:event_price_move` every 0.5s, plays crash/stab or ascending/descending arpeggios

## Tech Stack

- Python 3.12, asyncio (WindowsSelectorEventLoopPolicy on Windows)
- aiohttp (web server)
- python-osc (OSC messaging)
- websockets (Polymarket CLOB feed)
- requests (Gamma REST API)
- Sonic Pi 4.6 (Ruby 3.4.4 + SuperCollider scsynth 3.13.0, runs headless)
