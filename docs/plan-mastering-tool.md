# Plan: Browser-Based Mastering Tool

## Overview

An admin-only page at `/master` that lets the developer play any track with synthetic data, adjust per-instrument gain by ear, and save those adjustments for all future playback. Replaces the old Python CLI mastering pipeline.

---

## 1. Architecture

The mastering page operates independently from the main app. No live market connection needed — it generates synthetic data locally and feeds it to the track at the same 3s interval the server normally uses.

### Key design decisions

**Gain storage: Sidecar JSON files** (e.g., `frontend/tracks/oracle.master.json`)
- Separates mastering from composition — LLM authors tracks without worrying about normalization
- Version-controlled alongside tracks
- Audio engine auto-loads at track selection time; missing file = all gains at 1.0

**Instrument discovery: Static `instruments` declaration on each track**
- Each track class/object declares its instrument names and labels
- Mastering page reads this to build the gain mixer dynamically

**Admin protection: Query-string token** (`/master?key=<MASTER_KEY>`)
- Key set in `config.py`
- Server returns 403 without valid key
- Simple, sufficient for a tool that only writes JSON files

**Engine target: Build engine-agnostic**
- The per-instrument gain architecture (named gain nodes, `instruments` declaration, sidecar JSON) works for both Tone.js and Strudel
- Build against whichever engine is current; design transfers to the other

## 2. Per-Instrument Gain Architecture

### Track interface additions

Each track declares instruments and creates named gain nodes:

```javascript
class MezzanineTrack {
  static instruments = {
    sub:      { label: 'Sub Bass' },
    bass:     { label: 'Bass (303)' },
    arp:      { label: 'Arp (Pluck)' },
    kick:     { label: 'Kick' },
    snare:    { label: 'Snare' },
    hat:      { label: 'Hi-Hat' },
    rim:      { label: 'Rim' },
    vinyl:    { label: 'Vinyl Dust' },
    pad:      { label: 'Pad / Dub Wash' },
    deep:     { label: 'Deep Echo' },
    drift:    { label: 'Price Drift' },
    piano:    { label: 'Piano (Events)' },
    drone:    { label: 'Ambient Drone' },
    spike:    { label: 'Spike Cymbal' },
    resolved: { label: 'Resolved' },
  };

  constructor(destination) {
    this._gains = {};
    for (const key of Object.keys(MezzanineTrack.instruments)) {
      this._gains[key] = new Tone.Gain(1).connect(destination);
    }
    // Route each chain through its gain node:
    this.subFilter = new Tone.Filter({...}).connect(this._gains.sub);
    // etc.
  }

  setInstrumentGain(name, value) {
    if (this._gains[name]) {
      this._gains[name].gain.rampTo(value, 0.1);
    }
  }

  applyMasterConfig(config) {
    for (const [name, value] of Object.entries(config)) {
      this.setInstrumentGain(name, value);
    }
  }
}
```

### Instrument lists per track

**Oracle:** `piano`

**Mezzanine:** `sub`, `bass`, `arp`, `kick`, `snare`, `hat`, `rim`, `vinyl`, `pad`, `deep`, `drift`, `piano`, `spike`, `drone`, `resolved`

**Just Vibes:** `sub`, `bass`, `kick`, `snare`, `hat`, `rim`, `vinyl`, `pad`, `deep`, `priceDrift`, `eventMove`, `spike`, `drone`, `resolved`

### Routing principle

The gain node sits at the **end** of each instrument's signal chain, just before destination. It's a "bus fader" — the final volume control before the mix bus. Effects (reverb, filter) come before the gain node, not after.

Example: snare → snareReverb → `this._gains.snare` → destination

## 3. Sidecar JSON Format

File: `frontend/tracks/<track_name>.master.json`

```json
{
  "version": 1,
  "gains": {
    "sub": 1.0,
    "bass": 0.85,
    "arp": 1.2,
    "kick": 0.9,
    "snare": 1.0,
    "hat": 1.1,
    "pad": 1.3,
    "drift": 0.8
  }
}
```

Missing keys default to 1.0. Unknown keys are ignored (forward-compatible).

## 4. Audio Engine Changes

In `selectTrack()`, after constructing the track:
```javascript
try {
  const resp = await fetch(`/static/tracks/${name}.master.json`);
  if (resp.ok) {
    const config = await resp.json();
    if (config.gains && currentTrack.applyMasterConfig) {
      currentTrack.applyMasterConfig(config.gains);
    }
  }
} catch (e) { /* no config, fine */ }
```

New methods:
- `getTrackInstruments(name)` — returns `trackRegistry[name].instruments`
- `getActiveTrack()` — returns `currentTrack` for direct `setInstrumentGain()` calls

## 5. Server Endpoints

### `config.py`
```python
MASTER_KEY = "change-me-in-production"
```

### Routes

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/master` | `?key=` | Serves `master.html` (403 without key) |
| `GET` | `/api/master/config/{name}` | None | Returns current master.json |
| `POST` | `/api/master/config/{name}` | `?key=` | Saves gain config to disk |

POST body is the gains object. Server validates JSON structure, writes to `frontend/tracks/<name>.master.json`.

## 6. Mastering Page UI

Dark theme matching `style.css`. Four sections:

### Section 1: Transport
- Track dropdown
- Play / Stop button
- Master volume slider

### Section 2: Synthetic Data Controls

| Slider | Range | Default |
|--------|-------|---------|
| Heat | 0.0 – 1.0 | 0.3 |
| Price | 0.0 – 1.0 | 0.5 |
| Price Delta | -1.0 – +1.0 | 0.0 |
| Velocity | 0.0 – 1.0 | 0.1 |
| Trade Rate | 0.0 – 1.0 | 0.2 |
| Spread | 0.0 – 1.0 | 0.2 |
| Tone | Toggle: Major/Minor | Major |

**Presets:**
- Quiet Market: heat 0.1, velocity 0.05, trade_rate 0.1
- Normal: heat 0.3, velocity 0.1, trade_rate 0.2
- Active: heat 0.6, velocity 0.4, trade_rate 0.5, price_delta 0.3
- Spike: heat 0.9, velocity 0.8, trade_rate 0.8, price_delta 0.7
- Crash: heat 0.9, velocity 0.8, trade_rate 0.8, price_delta -0.8, tone minor

**Auto-cycle toggle:** Slowly ramps through scenarios over 60s.

Data feeds to `track.update(data)` via `setInterval` at 3s — no WebSocket needed.

### Section 3: Per-Instrument Gain Mixer
- Vertical fader strip per instrument (dynamically generated from `instruments`)
- Range: 0.0 – 2.0, default 1.0
- Current dB value display below each fader
- Solo button per strip (mutes all others)
- Mute button per strip
- Reset All button (all gains to 1.0)
- Save button → `POST /api/master/config/<track>`
- Load button → `GET /api/master/config/<track>`
- Green highlight on strips that differ from 1.0

### Section 4: Event Triggers
Manual buttons:
- Spike
- Price Move Up / Down
- Resolved Yes / No

## 7. New Files

| File | Purpose |
|------|---------|
| `frontend/master.html` | Mastering page HTML |
| `frontend/master.js` | UI logic, synthetic data, gain mixer, save/load |
| `frontend/tracks/*.master.json` | Sidecar gain configs (created by Save button) |

## 8. Phases

### Phase 1: Track instrument declarations
- Add `static instruments` to all three track classes
- Create per-instrument `Tone.Gain` nodes in constructors
- Rewire all `.connect(destination)` to `.connect(this._gains.<name>)`
- Add `setInstrumentGain()` and `applyMasterConfig()`
- Add gain node disposal in `stop()`
- **Test that tracks sound identical with all gains at 1.0**

This is the most delicate phase. Mezzanine has ~15 chains to rewire.

### Phase 2: Audio engine config loading
- Add `fetch` of master.json in `selectTrack()`
- Add `getTrackInstruments()` and `getActiveTrack()`
- Verify missing master.json causes no errors

### Phase 3: Server endpoints
- Add `MASTER_KEY` to `config.py`
- Add `/master`, `/api/master/config/{name}` handlers to `server.py`
- Key-based auth

### Phase 4: Mastering page UI
- `master.html` + `master.js`
- Track selection + audio init (reuses audio-engine.js and track files)
- Synthetic data sliders with presets
- Per-instrument gain mixer
- Event triggers
- Save/Load
- Auto-cycle mode

### Phase 5: Master the tracks
- Use the tool to balance each track by ear
- Save master.json files
- Verify they load correctly on the main page

## 9. Interaction with Strudel Migration

The mastering tool design is **engine-agnostic**:
- The `instruments` declaration pattern transfers directly to Strudel track objects
- Sidecar JSON and server endpoints don't care about audio engine
- In Strudel, per-instrument gain would be applied as `.gain(instrumentGainValue)` on each layer's pattern instead of via Tone.js GainNodes
- The mastering page UI is identical either way

**Recommendation:** Build Phase 1 (track rewiring) against whichever engine is current when you start. If Strudel migration happens first, build gain architecture in Strudel patterns from the start. If mastering tool comes first, build in Tone.js — the UI and server side carry over unchanged.
