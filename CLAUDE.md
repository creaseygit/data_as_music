# The Polymarket DJ — Claude Context

## What This Is

A multi-user web app that turns Polymarket prediction market activity into generative music via **Tone.js** (browser-based audio). Python scores markets by real-time heat, normalizes data to 0–1 ranges, applies a per-client **sensitivity curve**, and pushes adjusted values to each connected browser via WebSocket. Each track (`.js` file in `frontend/tracks/`) is a self-contained Tone.js musical interpretation of the data.

**Repo:** Private (GitHub)
**License:** Not open source (Tone.js dependency is MIT)

## How to Run

```bash
cd C:\Github\polymarket_dj
.\venv\Scripts\activate
python server.py
# Open http://localhost:8888
# Pick a market from browse tabs or paste a Polymarket URL
# Click Start to begin audio (runs in browser via Tone.js)
```

**Local dev requirements:** VPN required (user is in UAE, Polymarket blocks non-US traffic).
**Deployed:** AWS Lightsail in us-east-1 (no VPN needed) + CloudFlare (DNS/CDN/HTTPS).

## Architecture

```
CloudFlare → Nginx → Python aiohttp (data only) ←→ Polymarket APIs
                          ↓ WebSocket (per client)
                     Browser (Tone.js audio)
```

### Data Flow

1. `polymarket/gamma.py` — REST client fetches markets by volume, category, slug, or live finance pattern
2. `polymarket/websocket.py` — WebSocket subscribes to asset IDs, receives price changes/trades/book updates
3. `polymarket/scorer.py` — `MarketScorer` computes heat score (0-1) from price velocity, trade rate, volume, spread
4. `mixer/mixer.py` — `AutonomousDJ` manages market list, live finance auto-rotation. Events dispatched via async callback (no OSC)
5. `server.py` `broadcast_loop` — Per-client: normalizes raw data to 0–1, applies sensitivity power curve (`4^(1-2s)`), detects events, pushes JSON via WebSocket every 3s
6. `frontend/audio-engine.js` — Tone.js bridge: init, track lifecycle, data→synth routing
7. Track `.js` files — Self-contained Tone.js tracks that receive data via `update(data)` method

## Key Files

| File                      | Purpose                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server.py`               | **Main entry point**. aiohttp web server, WebSocket handler (`/ws`), per-client broadcast loop, browse API           |
| `sessions.py`             | `ClientSession` (per-client state) + `SessionManager` (shared Polymarket WS subscriptions via ref counting)          |
| `config.py`               | Tunable constants (API URLs, scoring weights, WS config, sensitivity defaults, event thresholds, `BROWSE_CATEGORIES`)|
| `polymarket/gamma.py`     | Gamma REST API client: `fetch_active_markets`, `fetch_browse_markets`, `fetch_market_by_slug`, etc.                  |
| `polymarket/websocket.py` | CLOB WebSocket feed. First message is a list (book snapshot), not a dict                                             |
| `polymarket/scorer.py`    | Heat scoring: `price_velocity * 0.35 + trade_rate * 0.40 + volume * 0.15 + spread * 0.10`                           |
| `mixer/mixer.py`          | `AutonomousDJ` — market selection via `pin_market()`, `_primary_asset()`, live finance auto-rotation                 |
| `frontend/index.html`     | Main page HTML, loads Tone.js from CDN                                                                                |
| `frontend/app.js`         | UI logic: browse tabs, market picker, sliders, now-playing display                                                    |
| `frontend/ws-client.js`   | WebSocket client with auto-reconnect                                                                                  |
| `frontend/audio-engine.js`| Tone.js init, track registry, data→synth bridge, music theory utilities                                              |
| `frontend/tracks/*.js`    | Track files: `oracle.js` (alert piano), `mezzanine.js` (ambient dub), `just_vibes.js` (lo-fi hip hop)               |
| `deploy/`                 | Nginx config, systemd service, EC2 setup script                                                                       |

## Tech Stack

- Python 3.12, asyncio, aiohttp (web server + WebSocket)
- websockets (Polymarket CLOB feed)
- requests (Gamma REST API)
- Tone.js (browser audio synthesis — MIT license)
- AWS Lightsail (us-east-1, $5/mo 1GB plan) + Nginx + CloudFlare

## Detailed Documentation Index

For deeper context, read the relevant doc below. **Only load what you need for the current task.**

| Doc | Contents | Read when... |
| --- | -------- | ------------ |
| [`docs/data-interface.md`](docs/data-interface.md) | Data values pushed to clients (heat, price, velocity, etc.), event triggers, system state, tone hysteresis, outcome selection | Working on data pipeline, scorer, mixer, or understanding what data tracks receive |
| [`docs/writing-tracks.md`](docs/writing-tracks.md) | How to write Tone.js tracks (interface, data mapping), existing track descriptions (oracle, mezzanine, just_vibes) | Writing, editing, or reviewing browser tracks |
| [`docs/live-finance.md`](docs/live-finance.md) | Rolling BTC/ETH market patterns (5m/15m/hourly), slug generation, auto-rotation logic | Working on live finance rotation, crypto browse tab, or slug matching |
| [`docs/web-ui-and-api.md`](docs/web-ui-and-api.md) | UI sections, WebSocket protocol, API endpoints, background loops, deployment | Modifying the web UI, WebSocket protocol, API endpoints, or deployment config |
| [`docs/gotchas.md`](docs/gotchas.md) | Known issues: Polymarket API, browse/config, legacy code | Hit a weird bug, need to understand non-obvious constraints |
| [`docs/sonic-pi-integration.md`](docs/sonic-pi-integration.md) | Legacy Sonic Pi headless launcher (local dev only, not deployed) | Working with Sonic Pi locally for track prototyping |
