# Data as Music — Claude Context

## What This Is

**Data as Music** (dam.fm) — *The Polymarket DJ*. A multi-user web app that turns prediction market activity into generative music via **Strudel** (browser-based audio, TidalCycles-inspired live coding patterns). Python scores markets by real-time heat, normalizes data to 0–1 ranges, applies a per-client **sensitivity curve**, and pushes adjusted values to each connected browser via WebSocket. Each track (`.js` file in `frontend/tracks/`) is a self-contained Strudel pattern that receives market data and generates music.

**Repo:** `creaseygit/data_as_music` on GitHub (public)
**License:** AGPL-3.0 (matching Strudel dependency)
**Domain:** dam.fm — Data as Music FM (CloudFlare DNS/CDN/HTTPS → Lightsail)

## How to Run

```bash
# macOS
source venv/bin/activate
python server.py

# Windows
.\venv\Scripts\activate
python server.py

# Open http://localhost:8888
# Pick a market from browse tabs or paste a market URL
# Audio auto-starts on market selection (Play/Stop toggle in Audio panel)
```

**Local dev requirements:** VPN required (user is in UAE, prediction market APIs block non-US traffic).
**Deployed:** AWS Lightsail in us-east-1 (no VPN needed) + CloudFlare (DNS/CDN/HTTPS).

## Architecture

```
CloudFlare → Nginx → Python aiohttp (data only) ←→ Market APIs (Polymarket)
                          ↓ WebSocket (per client)
                     Browser (Strudel audio)
```

### Data Flow

1. `market/gamma.py` — REST client fetches markets by volume, category, slug, or live finance pattern
2. `market/websocket.py` — WebSocket subscribes to asset IDs, receives price changes/trades/book updates
3. `market/scorer.py` — `MarketScorer` computes heat score (0-1) from price velocity, trade rate, volume, spread
4. `mixer/mixer.py` — `AutonomousDJ` manages market list, live finance auto-rotation. Events dispatched via async callback (no OSC)
5. `server.py` `broadcast_loop` — Per-client: normalizes raw data to 0–1, applies sensitivity (power curve for activity metrics, window-length scaling for momentum/volatility), detects events with magnitudes, pushes JSON via WebSocket every 3s
6. `frontend/audio-engine.js` — Strudel bridge: init, track lifecycle, data→pattern routing. Two track modes: `evaluateCode(data)` runs raw strudel code via `evaluate()` (identical to strudel.cc REPL); `pattern(data)` returns a Pattern object directly
7. Track `.js` files — Self-contained Strudel tracks. Evaluate-mode tracks return strudel code strings; pattern-mode tracks return Pattern objects

## Key Files

| File                      | Purpose                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server.py`               | **Main entry point**. aiohttp web server, WebSocket handler (`/ws`), per-client broadcast loop, browse API, `/sandbox` page route (`/master` redirects to `/sandbox`) |
| `sessions.py`             | `ClientSession` (per-client state) + `SessionManager` (shared market WS subscriptions via ref counting)              |
| `config.py`               | Tunable constants (API URLs, scoring weights, WS config, sensitivity defaults, event thresholds, `BROWSE_CATEGORIES`)|
| `market/gamma.py`         | Gamma REST API client: `fetch_active_markets`, `fetch_browse_markets`, `fetch_market_by_slug`, etc.                  |
| `market/websocket.py`     | CLOB WebSocket feed (`MarketFeed`). First message is a list (book snapshot), not a dict                              |
| `market/scorer.py`        | Heat scoring: `price_velocity * 0.35 + trade_rate * 0.40 + volume * 0.15 + spread * 0.10`. Whale detection (trade size ≥ 3x rolling median) |
| `mixer/mixer.py`          | `AutonomousDJ` — market selection via `pin_market()`, `_primary_asset()`, live finance auto-rotation                 |
| `frontend/index.html`     | Main page HTML, loads custom Strudel bundle                                                                           |
| `frontend/app.js`         | UI logic: browse tabs, market picker, sliders, now-playing display, dynamic track loader, ET→local time conversion for market names |
| `frontend/ws-client.js`   | WebSocket client with auto-reconnect                                                                                  |
| `frontend/audio-engine.js`| Strudel init, track registry, pattern lifecycle (two modes: `evaluate` for raw strudel code, `pattern` for Pattern objects), music theory utils, track state getters (`getTrackRegistry()`, `getCurrentTrack()`, `getLatestData()`, `isPlaying()`) |
| `frontend/tracks/*.js`    | Track files (auto-discovered, dynamically loaded): `late_night_in_bb.js` (Late Night in Bb — 8-voice jazz trio with voice gain system), `digging_in_the_markets.js` (Digging in the Markets — 8-voice lo-fi hip hop with swung drums and Rhodes), `weather_vane.js` (Weather Vane — single-voice vibraphone price-direction alert in the `alert` category), `so_over_so_back.js` (So Over, So Back — meme-voice sampler in the `funny` category; six-level signed intensity scale from `so_fucking_over` (big down) through `over` / `back` to `so_fucking_back` (big up), with firing density scaling alongside sample intensity), `_template.js` (annotated starter template for new tracks with voice/mastering support). Drop a new `.js` file here and restart the server — no other changes needed |
| `samples/`                | Local audio samples served at `/samples/` by the aiohttp static route. Registered as Strudel aliases in `audio-engine.js` prebake (`samples({ so_over: '/samples/so_over.mp3', ... })`) and referenced as `.s("so_over")` in tracks. See the `dam-strudel` skill for full sample workflow. |
| `frontend/sandbox.html`   | Sandbox & Mastering page (`/sandbox`): simulated market data sliders, presets, sweeps, event triggers, voice gain mixing with solo/mute, JSON export/import — no live market needed |
| `frontend/build/`         | npm build for custom Strudel bundle (`@strudel/web` + `@strudel/soundfonts`). Run `cd frontend/build && npm run build` to regenerate `frontend/strudel-bundle.js` |
| `deploy/`                 | Nginx config, `data-as-music.service` systemd unit, EC2 setup script. Deploy path: `/opt/data_as_music`                |

## Tech Stack

- Python 3.12, asyncio, aiohttp (web server + WebSocket)
- websockets (market CLOB feed)
- requests (Gamma REST API)
- Strudel 1.3.0 (browser audio synthesis — AGPL-3.0, TidalCycles-inspired patterns). Custom esbuild bundle includes `@strudel/web` + `@strudel/soundfonts` (GM instruments)
- AWS Lightsail (us-east-1, $5/mo 1GB plan) + Nginx + CloudFlare

## Detailed Documentation Index

For deeper context, read the relevant doc below. **Only load what you need for the current task.**

| Doc | Contents | Read when... |
| --- | -------- | ------------ |
| [`docs/musician-brief.md`](docs/musician-brief.md) | **Give this to musicians.** No-code brief: what each signal means musically, the four market moods, signal combinations, events, sensitivity, quick reference card | Briefing musicians, onboarding collaborators, explaining the data-to-music mapping |
| [`docs/data-interface.md`](docs/data-interface.md) | Technical data interface: all values pushed to clients, sensitivity mechanics (window-scaling vs power-curve), event triggers with magnitudes, momentum/volatility computation details | Working on data pipeline, scorer, mixer, or understanding signal internals |
| [`docs/writing-tracks.md`](docs/writing-tracks.md) | How to write Strudel tracks: code examples, pattern interface, data mapping, Strudel sound/effect reference, existing track descriptions | Writing, editing, or reviewing browser tracks (code-level) |
| [`docs/live-finance.md`](docs/live-finance.md) | Rolling BTC/ETH market patterns (5m/15m/hourly), slug generation, auto-rotation logic | Working on live finance rotation, crypto browse tab, or slug matching |
| [`docs/web-ui-and-api.md`](docs/web-ui-and-api.md) | UI sections, WebSocket protocol, API endpoints, background loops, deployment | Modifying the web UI, WebSocket protocol, API endpoints, or deployment config |
| [`docs/gotchas.md`](docs/gotchas.md) | Known issues: market API, browse/config, legacy code | Hit a weird bug, need to understand non-obvious constraints |
| [`docs/deployment.md`](docs/deployment.md) | Lightsail/Nginx/CloudFlare setup, deploy commands, systemd service, first-time provisioning | Deploying changes, server ops, infrastructure questions |
| [`docs/development/mastering-and-sandbox.md`](docs/development/mastering-and-sandbox.md) | **Implemented.** Design spec for mastering page (per-voice gain mixing), sandbox page (data simulation), voice gain system, JSON export format. Both pages live at `/master` and `/sandbox`. All music tracks (`late_night_in_bb`, `digging_in_the_markets`) are migrated to the voice gain system | Modifying mastering/sandbox pages, adding voices to new tracks, understanding the gain multiplier flow |