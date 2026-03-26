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
                       ↓
              Track Sandbox (localhost:8888/sandbox)
```

### Data Flow

1. `polymarket/gamma.py` — REST client fetches markets by volume, category, slug, or live finance pattern
2. `polymarket/websocket.py` — WebSocket subscribes to asset IDs, receives price changes/trades/book updates
3. `polymarket/scorer.py` — `MarketScorer` computes heat score (0-1) from price velocity, trade rate, volume, spread
4. `mixer/mixer.py` — `AutonomousDJ` manages which market to play. Always selects the primary (Yes/Up) outcome via `_primary_asset()`. Auto-rotates live finance markets when they expire
5. `server.py` `param_push_loop` — Normalizes raw data to 0–1 and pushes to Sonic Pi every 3s
6. `sonic_pi/headless.py` — Boots Sonic Pi daemon without GUI, sends code via OSC
7. Track `.rb` files — Self-contained musical interpretations that read raw data via `get()`

### Data-Music Interface

Python pushes **raw normalized market data** to Sonic Pi every 3 seconds via `run_code` / `set`. Tracks read these values with `get()` and decide their own musical interpretation. **Python does not prescribe musical behaviour** — no per-layer params, no instrument assumptions.

#### Data Values (pushed every 3s)

| Name          | Range     | Source                                                              |
| ------------- | --------- | ------------------------------------------------------------------- |
| `:heat`       | 0.0 – 1.0 | Composite market activity (velocity, trade rate, volume, spread)    |
| `:price`      | 0.0 – 1.0 | Current price (WS bid/ask midpoint preferred, Gamma API fallback)   |
| `:velocity`   | 0.0 – 1.0 | Price velocity (first derivative)                                   |
| `:trade_rate` | 0.0 – 1.0 | Trades per minute, normalized                                       |
| `:spread`     | 0.0 – 1.0 | Bid-ask spread, normalized (raw 0–0.3 → 0–1)                        |
| `:tone`       | 0 or 1    | 1 = major (price > 0.55), 0 = minor (price < 0.45), with hysteresis |

#### Event Triggers (one-shot, reset to 0)

| Name                | Values    | Condition                         |
| ------------------- | --------- | --------------------------------- |
| `:event_spike`      | 0 or 1    | Heat delta > 0.15 between pushes  |
| `:event_price_move` | -1, 0, +1 | Price delta > 3¢ (+1 up, -1 down) |

#### System State

| Name               | Values   | Meaning                                |
| ------------------ | -------- | -------------------------------------- |
| `:market_resolved` | 0, 1, -1 | Market resolved (1=Yes won, -1=No won) |
| `:ambient_mode`    | 0 or 1   | No active markets — ambient fallback   |

### Tone Hysteresis

Tone uses hysteresis to prevent major/minor flickering when price hovers near 0.50:

- Must drop below **0.45** to switch to minor
- Must rise above **0.55** to switch to major

### Price Display

The display price uses the **WebSocket bid/ask midpoint** as the primary source (real-time, matches Polymarket's live display). Falls back to the **Gamma REST API** (`outcomePrices` field, polled every 5s via `price_poll_loop`) when WebSocket data hasn't arrived yet.

### Single Market Model

The DJ plays **one market at a time** in manual mode only. Pick a market from browse tabs or paste a URL; it plays until you pick another via `pin_market()`.

### Outcome Selection

Markets have multiple outcomes (e.g., "Yes"/"No" or "Up"/"Down"), each with its own asset_id. `_primary_asset()` in `mixer.py` always picks the "Yes" or "Up" outcome to match Polymarket's headline display.

## Live Finance Markets (Auto-Rotation)

Polymarket has auto-generated rolling markets for BTC/ETH price movement with fixed time windows (5m, 15m, hourly). These rotate constantly — each window gets a new event with a timestamp-based or date-based slug.

### How It Works

1. **Timestamp-based (5m, 15m):** `LIVE_FINANCE_PATTERNS` in `gamma.py` defines patterns: `btc-updown-5m`, `btc-updown-15m`, `eth-updown-5m`, `eth-updown-15m`. Slugs use Unix timestamps (e.g. `btc-updown-15m-1774424700`)
2. **Hourly date-based:** `LIVE_HOURLY_PATTERNS` defines patterns: `bitcoin-up-or-down`. Slugs use ET date+hour (e.g. `bitcoin-up-or-down-march-25-2026-3am-et`, `bitcoin-up-or-down-march-25-2026-1pm-et`). Built by `_hourly_slug()` using 12-hour format with am/pm suffix
3. `fetch_live_finance_markets()` computes the current window boundary from the system clock and tries current + next window slugs for both pattern types
4. Hourly slugs use `_now_et()` which calculates US Eastern time with DST (no `tzdata` dependency — uses manual DST calculation for Windows compatibility)
5. The "BTC Live" browse tab (`tag_id: "live"`) calls this function. Results are never cached client-side since they rotate
6. Users can also paste hourly URLs directly (e.g. `https://polymarket.com/event/bitcoin-up-or-down-march-25-2026-1am-et`) — auto-rotation works the same way

### Auto-Rotation

When a live finance market is playing (any type — 5m, 15m, or hourly):

- `_check_live_rotation()` runs every 30s in the DJ loop, compares `end_date` against UTC now
- Console shows `[LIVE] <event_slug> ends in 7m23s` countdown
- When `end_date` passes, `_rotate_live_market()` fetches the next window's market matching the same prefix pattern (e.g. stays on 15m if you started on 15m, stays on hourly if you started on hourly)
- Prefix extraction strips the timestamp or date suffix to find the base pattern (e.g. `bitcoin-up-or-down-march-25-2026-1am-et` → `bitcoin-up-or-down`)
- On WebSocket resolution event, rotation triggers immediately without waiting for the 30s cycle
- `_LIVE_SLUG_RE` regex identifies live finance markets by event_slug pattern: matches both `(btc|eth)-updown-\d+m-\d+` and `bitcoin-up-or-down-*-et`

### Event Slug Injection

Markets fetched via `fetch_markets_by_event_slug()` have the parent event's slug injected into each nested market's `event_slug` field. Without this, the live finance detection regex can't match (nested markets from the events API don't carry their parent event slug natively).

## Key Files

| File                      | Purpose                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server.py`               | **Main entry point** (~1750 lines). Web server, background loops (data push, price poll), all API handlers, full HTML UI (main page + sandbox page), track analyzer |
| `config.py`               | All tunable constants (API URLs, scoring weights, OSC config, `BROWSE_CATEGORIES`)                                                                                  |
| `console.py`              | Rich debug console with logging wrappers (legacy, imports stale `SLOT_OSC_MAP`)                                                                                     |
| `polymarket/gamma.py`     | Gamma REST API client: `fetch_active_markets`, `fetch_browse_markets`, `fetch_market_by_slug`, `fetch_markets_by_event_slug`, `fetch_live_finance_markets`          |
| `polymarket/websocket.py` | CLOB WebSocket feed. First message is a list (book snapshot), not a dict                                                                                            |
| `polymarket/scorer.py`    | Heat scoring: `price_velocity * 0.35 + trade_rate * 0.40 + volume * 0.15 + spread * 0.10`. Adaptive trade rate uses EMA baseline with log curve                     |
| `mixer/mixer.py`          | `AutonomousDJ` — manual market selection via `pin_market()`, `_primary_asset()`, `_seed_prices()`, live finance auto-rotation                                       |
| `mixer/state.py`          | `LayerState`/`MixerState` dataclasses (deprecated, unused)                                                                                                          |
| `mixer/transitions.py`    | Fade-in/out/crossfade utilities (deprecated, unused)                                                                                                                |
| `osc/bridge.py`           | Minimal OSC wrapper — `send_global()` for one-off events (resolution, ambient). `_scale()` utility                                                                  |
| `sonic_pi/headless.py`    | Boots Sonic Pi daemon headlessly, manages keep-alive, sends code via `/run-code` OSC, listens for Spider errors                                                     |

## Tracks

### oracle.rb
Minimal piano-only track with a single `price_watch` loop. Responds to any price movement > 1¢:
- **`price_watch`** — Detects price deltas > 1¢. Plays ascending/descending piano motifs (2–6 notes) scaling with move magnitude. C major when bullish, A minor when bearish. Volume scales with velocity, trade_rate, and move magnitude but kept quiet (master volume 0.3, per-note amp capped at 0.05)

Reads `:price`, `:tone`, `:velocity`, `:trade_rate`. Ignores heat, spread, events, resolution.

### mezzanine.rb
Sigur Rós "Teardrop"-inspired ambient track, BPM 80. Am → Am → F → G progression. Features teardrop arpeggio (pluck), sub bass, bass line (tb303 with 4 phrase variants), kick, kick ghost, snare, ambient pad. Velocity-driven octave jumps in arpeggio. Heat-driven inverse amp (louder when calm).

### just_vibes.rb
Lo-fi hip hop track, BPM 75. Key: F major / D minor. Chord clock syncs all harmonic loops via shared `chord_idx`. Rhythmic bed: kick (half-time), snare (beat 3 with reverb), hats, rim clicks, sub bass (sine), warm bass (tb303, very low cutoff, 4 randomized phrases), hollow pad (inverse to heat), vinyl hiss, deep echo. Melodic elements only on market movement: piano motifs on price drift > 2¢, 7-note piano arpeggio on event_price_move, resolution figure. Tone-aware progressions: Fmaj7→Em7→Dm7→Cmaj7 (bullish) / Dm7→Bbmaj7→Gm7→Am7 (bearish).

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

**Orphan cleanup:** Previous headless instances can leave `scsynth.exe` and `ruby.exe` running. The Stop button and Kill All button both run `taskkill /F` on these processes. The `atexit` handler in `headless.py` also cleans up.

**Track hot-reload:** Tracks are re-discovered from disk on every Start and Track Switch, so new/edited/deleted `.rb` files are picked up without restarting the server.

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

4. **Treat amp as relative volume** — the mastering pipeline normalizes all instruments to equal loudness, so `amp: 0.3` on any synth/sample produces the same perceived volume. Use `set_volume! 0.7` for master headroom, keep individual amps under 0.5. After writing a track, run `python -m mastering --all` to apply normalization factors.

5. **Keep the file concise** — under ~14KB raw. `run_file` strips comments automatically, but stay within budget

6. **Do not use Sonic Pi reserved names as variables** — e.g., `range`, `tick`, `ring`, `play`, `sample`, `sleep`

7. **Use correct chord names** — `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7` (NOT `:major9`, `:minor9`, `:M9`)

See `midnight_ticker.rb` for the full data interface, `oracle.rb` for a minimal price-only approach. Use the **Track Sandbox** (`/sandbox`) to test tracks with manual slider control.

### Instrument Loudness Normalization

The mastering pipeline (`python -m mastering --all`) ensures all synths and samples produce equal perceived loudness at the same `amp:` value. It multiplies each `amp:` expression by a per-instrument factor (e.g., `amp: 0.18 * 0.85  # ~nf`). Lines marked `# ~nf` have been normalized.

**When writing tracks:** Set amp values based on the mix role you want — louder for leads/kicks, quieter for textures/ambience. Don't worry about intrinsic instrument loudness differences; the mastering pipeline handles that.

**After writing/modifying tracks:** Run `python -m mastering --all` to apply normalization. Use `--revert` to undo.

### Mastering Pipeline

Located in `mastering/` with its own docs at `mastering/MASTERING.md`. Workflow:

1. `instruments.py` — Extract all unique synths/samples from .rb files
2. `recorder.py` — Boot Sonic Pi headless, play each instrument at amp=0.3, record 5s WAV
3. `analyzer.py` — Measure LUFS (integrated loudness) using librosa + pyloudnorm
4. `apply.py` — Parse each .rb, find `amp:` expressions, multiply by per-instrument factor, mark with `# ~nf`
5. Output: `mastering_output/normalization_table.json`

Extra deps: `pip install -r requirements-mastering.txt` (pyloudnorm, librosa, soundfile, numpy)

## Background Loops

| Loop                           | Interval  | Purpose                                                                          |
| ------------------------------ | --------- | -------------------------------------------------------------------------------- |
| `param_push_loop`              | 3s        | Push raw normalized market data + event triggers to Sonic Pi via `run_code`      |
| `price_poll_loop`              | 5s        | Fetch current market's API price from Gamma (fallback, uses `asyncio.to_thread`) |
| `dj_loop` / `_refresh_markets` | 30s       | Re-fetch top 50 markets, update scorer volumes, seed prices, check live rotation |
| WebSocket feed                 | Real-time | Price changes, trades, book updates → scorer                                     |
| UI status poll                 | 1.5s      | Browser polls `/api/status` to update Now Playing + controls                     |

## Web UI Structure

### Main Page (localhost:8888)

The UI has four sections:

1. **Audio** — Start/Stop, track selector, volume control, test sounds, Kill All, link to Track Sandbox
2. **Now Playing** — Current market question, bullish/bearish + price %, raw data values (heat, velocity, trade rate, spread), link to Polymarket
3. **Feed** — WebSocket connection status
4. **Markets** — URL paste input, "Your Markets" (session list), Browse tabs (Trending, BTC Live, Politics, Sports, Crypto, Finance, Culture, Geopolitics, Tech, Closing Soon)

### Track Sandbox (localhost:8888/sandbox)

A development tool for testing tracks without live market data:

- Track selection + Start/Stop (boots Sonic Pi in sandbox mode — no market data push)
- Manual sliders for all data values: heat, price, velocity, trade_rate, spread (0–1)
- Toggle buttons for tone (major/minor) and ambient mode
- One-shot event buttons: heat spike, price up, price down, resolved yes, resolved no
- **Track Analyzer**: Parses .rb file with regex, shows each `live_loop` and which `get(:param)` calls it reads. Visualizes the instrument-to-data mapping

### Browse Tabs

Each tab fetches 10 markets from the Gamma API filtered by `tag_id` (defined in `BROWSE_CATEGORIES` in config.py). Results are cached client-side per tab (except "BTC Live" which always fetches fresh). "Trending" = all markets sorted by volume. "Closing Soon" = sorted by end_date ascending. "BTC Live" = calls `fetch_live_finance_markets()` to find current rolling BTC/ETH windows. Clicking "Play" on a browse result fetches the market via `/api/play-url`, injects it into the DJ, and adds it to "Your Markets".

### Your Markets

A session-only list (JS array, not persisted) of markets the user has played. Clicking replays via `/api/pin`. Cleared with the "Clear" button.

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

## Known Issues / Gotchas

- **VPN required** — Polymarket blocks UAE/non-US IPs at the TLS level
- **16KB OSC packet limit** — Sonic Pi's UDP recv buffer is 16384 bytes. Track files that exceed this (with OSC overhead) are silently dropped. `run_file` strips comments automatically, but keep `.rb` files under ~14KB raw
- **Sonic Pi reserved names** — Sonic Pi's pre-parser forbids using built-in function names as variables. Known reserved: `range`, `tick`, `ring`, `play`, `sample`, `sleep`, `use_synth`, etc. Use alternatives (e.g., `span` instead of `range`)
- **Sonic Pi chord names** — Use `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7`, `:dim7`, `:aug`, `:sus2`, `:sus4`, etc. NOT `:major9`/`:minor9`/`:M9`. Check `chord.rb` in Sonic Pi install for the full list
- **`clobTokenIds`** from Gamma API is a JSON string, not a list — parsed by `_parse_clob_token_ids()` in `gamma.py`
- **`outcomePrices`** from Gamma API is also a JSON string — parsed by `_parse_json_string()` in `gamma.py`
- **Outcome ordering** — `asset_ids[0]` does NOT always correspond to "Yes"/"Up". Use `_primary_asset()` which checks the `outcomes` array to find the correct one
- **Gamma API prices can be stale** — For fast-moving short-duration markets (e.g., 15-min BTC windows), the Gamma REST API `outcomePrices` may lag behind the live price. Display uses WebSocket bid/ask midpoint as primary source, with Gamma as fallback
- **WebSocket raw trade prices are unreliable** — Raw trade prices spike to 0.99/0.01 on thin order books. The bid/ask midpoint from the order book is used instead (more stable than last trade price)
- **WebSocket first message is a list** — `_dispatch()` handles both list and dict messages
- **Audio device** — scsynth outputs to Windows default audio device
- **Headless error visibility** — Spider errors are captured via a UDP listener on `gui_listen_port` and printed to the server console as `[SONIC PI ERROR]`. Without this, errors are silently swallowed in headless mode. Noisy messages (`/incoming/osc`, `/log/info`) are filtered out
- **Browse tab tag_ids** — Hardcoded in `BROWSE_CATEGORIES` in config.py. If Polymarket changes their tag IDs, these need updating. Current values: Politics=2, Sports=100639, Crypto=21, Finance=120, Culture=596, Geopolitics=100265, Tech=1401
- **Event slug on nested markets** — Markets fetched via `fetch_markets_by_event_slug()` don't natively carry the parent event's slug. The function injects `event_slug` from the parent event object. Without this, live finance detection fails
- **No `tzdata` on Windows** — `zoneinfo` module requires `tzdata` package on Windows. Live finance hourly slugs use `_now_et()` which calculates ET offset manually with DST approximation instead
- **Live rotation timing** — The DJ checks for expired live markets every 30s (`RESCORE_INTERVAL`). There may be up to 30s delay between market close and rotation. WebSocket resolution events trigger immediate rotation when available
- **console.py is stale** — Imports `SLOT_OSC_MAP` from `osc/bridge.py` which no longer exports it. Legacy file, not used by the main app
- **mixer/state.py and mixer/transitions.py are deprecated** — Leftover from earlier multi-layer architecture, not used by current code

## Web API Endpoints

| Method | Path                 | Purpose                                                                                                                |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------ | -------------- |
| GET    | `/api/status`        | Current state: audio, feed, current market + price + raw data values                                                   |
| POST   | `/api/start`         | Boot Sonic Pi, load track. Body: `{"track": "midnight_ticker"}`                                                        |
| POST   | `/api/stop`          | Stop audio gracefully                                                                                                  |
| POST   | `/api/test-sound`    | Test audio. Body: `{"type": "beep"                                                                                     | "kick" | "all_layers"}` |
| POST   | `/api/track`         | Switch track. Body: `{"track": "midnight_ticker"}`                                                                     |
| POST   | `/api/volume`        | Set master volume. Body: `{"volume": 0.7}`                                                                             |
| POST   | `/api/pin`           | Play specific market already in DJ's list. Body: `{"slug": "..."}`                                                     |
| POST   | `/api/play-url`      | Play from Polymarket URL (fetches + injects + pins). Body: `{"url": "..."}`                                            |
| POST   | `/api/unpin`         | Clear pin (stays on current market)                                                                                    |
| POST   | `/api/kill-all`      | Kill all scsynth.exe and ruby.exe processes                                                                            |
| GET    | `/api/browse`        | Browse markets by category. Params: `tag_id` (int, or `"live"` for rolling finance), `sort` (volume\|closing), `limit` |
| GET    | `/api/categories`    | Returns list of browse tab definitions from `BROWSE_CATEGORIES`                                                        |
| GET    | `/api/track/analyze` | Parse .rb file, return live_loops + data params each reads. Params: `track`                                            |
| GET    | `/sandbox`           | Track Sandbox page                                                                                                     |
| POST   | `/api/sandbox/start` | Boot Sonic Pi in sandbox mode (no market data). Body: `{"track": "..."}`                                               |
| POST   | `/api/sandbox/stop`  | Stop sandbox mode                                                                                                      |
| POST   | `/api/sandbox/push`  | Push manual data values. Body: `{"heat": 0.5, "price": 0.6, ...}`                                                      |

## Tech Stack

- Python 3.12, asyncio (WindowsSelectorEventLoopPolicy on Windows)
- aiohttp (web server)
- python-osc (OSC messaging)
- websockets (Polymarket CLOB feed)
- requests (Gamma REST API)
- Sonic Pi 4.6 (Ruby 3.4.4 + SuperCollider scsynth 3.13.0, runs headless)
