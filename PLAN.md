# Polymarket Bar — Implementation Plan

## Pre-Implementation: Environment Setup

1. **Install Sonic Pi** — download from sonic-pi.net (must run with GUI, no headless mode)
2. **Install virtual audio cable** — VB-CABLE (free, vb-audio.com/Cable/) to route Sonic Pi audio into OBS
3. **Python venv** — create venv, install `python-osc`, `websockets`, `requests`. Remove `asyncio` from requirements.txt (stdlib in Python 3.12)
4. **Verify Polymarket APIs** — both Gamma REST and CLOB WebSocket are public, no auth needed. Field names in the API response must be validated against live data before building parsers.

---

## Phase 1: Get Sound Playing

### 1.1 Project scaffolding
Create all directories and `__init__.py` files:
```
polymarket_dj/
  main.py
  config.py
  requirements.txt
  polymarket/__init__.py
  polymarket/gamma.py
  polymarket/websocket.py
  polymarket/scorer.py
  mixer/__init__.py
  mixer/mixer.py
  mixer/transitions.py
  mixer/state.py
  osc/__init__.py
  osc/bridge.py
  sonic_pi/bar_track.rb
  stream/obs_setup.md
```
Dependencies: None.

### 1.2 `config.py`
Copy from spec lines 82-119. All tunable constants live here.

Dependencies: None.

### 1.3 `polymarket/gamma.py` — Market Discovery
Implement `fetch_active_markets()` and `fetch_market_by_slug()` per spec.

**Validation needed:** Confirm Gamma API field names (`clobTokenIds`, `volume24hr`, `endDate`, `tags`) match live responses. Run standalone test to verify.

Dependencies: config.py

### 1.4 `polymarket/scorer.py` — Market Heat Scoring
Implement `MarketScorer` class per spec. Pure computation, no external deps.

**Test:** Feed synthetic price changes and trades, verify `heat()` returns 0.0–1.0.

Dependencies: config.py

### 1.5 `polymarket/websocket.py` — Real-time Feed
Implement `PolymarketFeed` class per spec. Async WebSocket client with reconnection loop.

**Key detail:** Subscription messages use `assets_ids` (Polymarket's naming).

**Validation needed:** Build a simple message logger first to confirm message format (`event_type`, `price_changes`, `best_bid`, `best_ask`) matches spec assumptions.

Dependencies: config.py, scorer.py

### 1.6 `osc/bridge.py` — OSC Parameter Bridge
Implement `OSCBridge` class per spec using `python-osc` `SimpleUDPClient`.

**Test:** Send `/btc/kick/amp 0.8` to Sonic Pi, verify in Sonic Pi's cue log.

**Windows note:** Sonic Pi may use a different OSC port depending on version. Check Sonic Pi's log file (`~/.sonic-pi/log/`) for actual listening port.

Dependencies: config.py, scorer.py, Sonic Pi installed and running

### 1.7 `sonic_pi/bar_track.rb` — Generative Music
Implement the Sonic Pi code per spec.

**DESIGN FIX REQUIRED:** The spec's per-layer OSC listeners use sequential `sync` calls (amp, cutoff, reverb, density, tone, tension, command). This will stall if messages arrive out of order. Replace with individual `live_loop` per parameter:
```ruby
live_loop :kick_amp_listener do
  use_real_time
  v = sync "/osc*/btc/kick/amp"
  set :kick_amp, v[0]
end
```
More live loops but much more robust.

**Implementation order within file:**
1. Global state init + BPM
2. Global OSC listener
3. Layer state initialization
4. Per-layer OSC listeners (redesigned)
5. Kick loop
6. Bass loop
7. Pad loop
8. Lead loop
9. Atmosphere loop
10. Resolution handler
11. Ambient mode loop

Dependencies: Sonic Pi installed

### 1.8 `main.py` — Single Market End-to-End
Simplified Phase 1 version: fetch top market from Gamma, subscribe via WebSocket, push OSC params to Sonic Pi on a timer. Verify full data flow.

Dependencies: All above

### 1.9 OBS Streaming Setup
- Document config in `stream/obs_setup.md`
- Set Sonic Pi output → virtual audio cable
- Set OBS audio capture → same virtual cable
- Configure RTMP output to YouTube

Dependencies: Virtual audio cable, Sonic Pi, OBS

### Phase 1 Verification
- [ ] `fetch_active_markets()` returns data
- [ ] WebSocket receives price_change events
- [ ] OSC messages produce sound in Sonic Pi
- [ ] Kick drum responds to market trades
- [ ] OBS captures audio and streams to YouTube

---

## Phase 2: Autonomous DJ

### 2.1 `mixer/state.py` — Playing State
Dataclass for current mixer state: layer assignments, amplitudes, transition timestamps, ambient mode flag.

Dependencies: Phase 1

### 2.2 `mixer/transitions.py` — Crossfade Logic
Implement `GradualFade` class that sends multiple OSC amp updates over time (8 bars at 124 BPM ≈ 15.5 seconds). Use `asyncio.create_task` for concurrent fades. Track active fades so they can be cancelled.

**Alternative:** Let Sonic Pi handle fade envelopes (send "fade to X over N beats" command). Worth prototyping both approaches.

Dependencies: Phase 1

### 2.3 `mixer/mixer.py` — Full AutonomousDJ
Implement per spec:
- `run()` loop: refresh + mix every `RESCORE_INTERVAL`
- `_refresh_markets()`: Gamma fetch, scorer volume update, WebSocket subscription management
- `_mix()`: rank by heat, assign to layer slots, trigger transitions
- `on_market_resolved()`: dramatic musical event + layer removal
- `SWAP_THRESHOLD` (0.25) prevents thrashing
- Ambient mode when no markets exceed `MIN_TRADE_RATE`

Dependencies: 2.1, 2.2

### 2.4 Continuous OSC Parameter Push
Add async loop that pushes current market params to Sonic Pi every 2-5 seconds for all active layers. Without this, music only changes on transitions.

Dependencies: 2.3

### 2.5 Now Playing JSON Writer
Add `write_now_playing()` to `osc/bridge.py` per spec. Writes `now_playing.json` every few seconds.

Dependencies: 2.3

### 2.6 OBS Browser Overlay
Create `stream/overlay.html`:
- Polls `now_playing.json` via fetch()
- Displays layers, market questions, heat bars
- Dark theme, monospace, neon accents

**CORS note:** OBS Browser Source loading local files may block fetch() to local JSON. Solution: run a tiny HTTP server (`python -m http.server 8080`) and point OBS to `http://localhost:8080/overlay.html`.

Dependencies: 2.5

### 2.7 `main.py` — Full Orchestration
```python
await asyncio.gather(
    feed.connect(),
    dj.run(),
    param_push_loop(),
    overlay_writer_loop(),
)
```

Dependencies: All Phase 2

### Phase 2 Verification
- [ ] Multiple layers play simultaneously with distinct sounds
- [ ] Hot markets fade into layers within one RESCORE_INTERVAL
- [ ] Cooling markets fade out
- [ ] Crossfades are smooth (no pops/cuts)
- [ ] Market resolution triggers ascending/descending motif
- [ ] OBS overlay shows market names and heat levels
- [ ] Stable for 1+ hours without crashes or memory leaks

---

## Phase 3: Request Mode

### 3.1 Web Server
Minimal async web server (aiohttp or FastAPI) running in the same asyncio loop:
- `POST /pin {"slug": "..."}` — pin market as lead
- `POST /unpin` — remove pin
- `GET /status` — current layers and pinned market

### 3.2 Web UI
Static HTML (`stream/request.html`): input for Polymarket URL/slug, request button, current state display.

### 3.3 YouTube Chat Bot
Listen to YouTube Live Chat for `!play <slug>` commands:
- Use YouTube Data API v3 or `pytchat` library
- Pin requested market for configurable duration (e.g. 3 minutes)
- Rate limit per viewer
- Requires YouTube API key in `.env`

### 3.4 Pin Timeout & Queue
- Auto-expire pins after configurable duration
- Queue multiple requests, play each for N minutes
- Show queue position in overlay

### Phase 3 Verification
- [ ] `/pin` causes market to take lead layer within one mix cycle
- [ ] Pin expires after timeout, DJ returns to autonomous mode
- [ ] `!play` command works from YouTube chat
- [ ] Queue handles multiple requests

---

## Key Risks & Gotchas

| Risk | Mitigation |
|------|-----------|
| Sonic Pi OSC listener stalls (sequential sync) | Redesign as individual live_loop per parameter |
| Windows asyncio ProactorEventLoop issues | Add `WindowsSelectorEventLoopPolicy` if websockets misbehave |
| Polymarket API field names changed | Validate against live API response in Task 1.3 |
| WebSocket message format differs from spec | Build message logger before wiring into scorer |
| Memory growth from stale subscriptions | Unsubscribe closed/resolved markets in `_refresh_markets()` |
| Sonic Pi OSC port differs on Windows | Check Sonic Pi log for actual port |
| OBS CORS blocks local JSON fetch | Use local HTTP server for overlay |

---

## Build Order Summary

1. config.py
2. polymarket/gamma.py + validate API
3. polymarket/scorer.py
4. osc/bridge.py + install Sonic Pi + test OSC
5. sonic_pi/bar_track.rb (get sound working with manual OSC)
6. polymarket/websocket.py (validate message format)
7. main.py Phase 1 (single market end-to-end)
8. OBS + virtual audio cable setup
9. mixer/state.py, mixer/transitions.py, mixer/mixer.py
10. Continuous parameter push loop
11. Now Playing overlay
12. main.py Phase 2 (full orchestration)
13. Request mode web server + YouTube chat bot
