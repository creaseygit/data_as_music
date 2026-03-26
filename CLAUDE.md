# The Polymarket DJ — Claude Context

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

## Tech Stack

- Python 3.12, asyncio (WindowsSelectorEventLoopPolicy on Windows)
- aiohttp (web server)
- python-osc (OSC messaging)
- websockets (Polymarket CLOB feed)
- requests (Gamma REST API)
- Sonic Pi 4.6 (Ruby 3.4.4 + SuperCollider scsynth 3.13.0, runs headless)

## Detailed Documentation Index

For deeper context, read the relevant doc below. **Only load what you need for the current task.**

| Doc | Contents | Read when... |
| --- | -------- | ------------ |
| [`docs/data-interface.md`](docs/data-interface.md) | All data values pushed to Sonic Pi (heat, price, velocity, etc.), event triggers, system state, tone hysteresis, price display source, outcome selection | Working on data pipeline, scorer, mixer, or understanding what data tracks receive |
| [`docs/sonic-pi-integration.md`](docs/sonic-pi-integration.md) | Headless launcher internals, OSC protocol, 16KB limit, orphan cleanup, track hot-reload, error visibility | Debugging Sonic Pi boot/connection issues, modifying headless.py, or troubleshooting audio |
| [`docs/writing-tracks.md`](docs/writing-tracks.md) | How to write .rb tracks (defaults, metadata, data mapping), existing track descriptions (oracle, mezzanine, just_vibes), mastering pipeline | Writing, editing, or reviewing Sonic Pi tracks; running mastering |
| [`docs/live-finance.md`](docs/live-finance.md) | Rolling BTC/ETH market patterns (5m/15m/hourly), slug generation, auto-rotation logic, event slug injection | Working on live finance rotation, crypto browse tab, or slug matching |
| [`docs/web-ui-and-api.md`](docs/web-ui-and-api.md) | UI sections (main page, sandbox), browse tabs, API endpoints table, background loop intervals, console log tags | Modifying the web UI, adding/changing API endpoints, or debugging background loops |
| [`docs/gotchas.md`](docs/gotchas.md) | Known issues grouped by area: environment, Sonic Pi, Polymarket API, browse/config, legacy/deprecated code | Hit a weird bug, need to understand non-obvious constraints, or onboarding |
