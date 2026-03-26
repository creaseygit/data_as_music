# Plan: Tone.js → Strudel Migration

## Overview

Replace Tone.js with Strudel (`@strudel/web`) as the browser audio engine. Rewrite all three tracks as Strudel patterns. Change license to AGPL-3.0.

---

## 1. Package Integration

**Approach: CDN, no bundler** (matches current architecture — no `package.json`, plain `<script>` tags).

Replace in `index.html`:
```html
<!-- REMOVE -->
<script src="https://unpkg.com/tone@15.0.4/build/Tone.js" ...></script>
<!-- ADD -->
<script src="https://unpkg.com/@strudel/web@1.2.6"></script>
```

`@strudel/web` is batteries-included: core pattern engine, mini-notation parser, superdough synth engine, scheduler. All Strudel functions become globals after `initStrudel()`.

Pin version with SRI hash, matching current Tone.js pattern.

## 2. New `audio-engine.js` Design

### Initialization
Replace `Tone.start()` with `initStrudel()`. The init call registers the local sample map via `prebake` callback.

### Scheduler
Instead of `Tone.Transport`, use a Strudel `repl()` instance:
```javascript
const { scheduler } = repl({
  defaultOutput: webaudioOutput,
  getTime: () => getAudioContext().currentTime,
});
```

The scheduler has `start()`, `stop()`, and `setPattern(pattern)` — which is how patterns get swapped at runtime.

### Track interface change
Tracks become **functions that return a Strudel Pattern** given current data state. The engine calls `scheduler.setPattern(pattern)` whenever:
- A new track is selected
- New market data arrives (every 3s — regenerate pattern)
- An event fires

### Per-track gain isolation
No Tone.js GainNode graph. Instead:
- `scheduler.stop()` + `setPattern(silence)` to kill previous track
- Each track pattern applies `.gain(trackGainValue)` as a pattern modifier
- Master volume via `.postgain(masterVolume)` wrapping the final pattern

### Music theory utilities
`SCALES`, `midiToNote`, `noteToMidi`, `midiToHz`, `getScaleNotes` — pure utility code, no Tone.js dependency. Keep as-is.

### Sample bank
Replace `sampleBank` IIFE with Strudel `samples()` call during init (see §5).

### New shape
```
audioEngine = {
  init()              — initStrudel(), create repl, register samples
  selectTrack(name)   — look up track, store current track fn, generate pattern
  stop()              — scheduler.stop(), silence
  setVolume(v)        — store master gain, regenerate pattern
  onMarketData(data)  — store data, call track fn, setPattern
  handleEvent(msg)    — call track's event handler, optionally layer one-shot
  registerTrack(name, trackDef)
}
```

## 3. Track Interface Design

```javascript
const oracleTrack = {
  name: 'oracle',
  label: 'Oracle',
  category: 'alert',

  // Instruments map for mastering tool (see mastering plan)
  instruments: {
    piano: { label: 'FM Piano' },
  },

  // Called every data tick. Returns a Strudel Pattern.
  pattern(data) {
    // data = { heat, price, price_delta, velocity, trade_rate, spread, tone, ... }
    return stack(bassPattern, drumPattern, arpPattern);
  },

  // Optional: discrete events, return one-shot pattern or null
  onEvent(type, msg, data) {
    return null;
  }
};
```

**Key principle: patterns are regenerated, not mutated.** Called fresh every 3s with new data. No ramping — the 3s interval is slow enough that stepped parameter changes sound fine.

**Persistent state** (e.g., `chordIdx`) lives as mutable properties on the track object.

**Event handling:** On event, regenerate pattern with event baked into the current cycle. Next tick, event is gone. Simple, no temporary layering needed.

## 4. Per-Track Migration Strategy

### Oracle (alert piano)
- Simplest — already operates on a 3-second cycle
- Check `|price_delta| > 0.1`; if not, return `silence`
- Compute note count, scale, volume from data (same math)
- FM piano: `note("C4 E4 G4 C5").s("fm").fmi(modIndex).fmh(2).gain(amp).room(0.6).lpf(3000)`
- **Risk:** FM modulation envelope (fast decay for piano hammer strike) may not have precise equivalent in superdough's `fmdecay`/`fmenv`. Test early; fallback to piano sample.

### Mezzanine (ambient dub, 80 BPM)
- Most complex: 12+ layers
- Build each layer as separate pattern, `stack()` them
- Port order: drums (samples, easy to A/B) → bass → arp → pads → events
- **Challenges:**
  - Complex bass phrases with rests → mini-notation `~` rests, Euclidean rhythms
  - Probabilistic hats → `.sometimesBy(probability, ...)`
  - Variable-interval loops (pad 6-8 beats) → fixed interval + data-driven skip
  - No PluckSynth equivalent → short bright synth + reverb, or load pluck sample
  - Sample params: `playbackRate` → `speed`, `finish` → `end`, `cutoff` → `lpf`, `pan` → `pan` (0-1 not -1 to 1)

### Just Vibes (lo-fi hip hop, 75 BPM)
- Same structure as mezzanine, different musical content
- Port after mezzanine establishes patterns/utilities

## 5. Sample Bank Integration

206 OGG files in `frontend/samples/`, served at `/static/samples/`.

Register via `samples()` during init:
```javascript
await initStrudel({
  prebake: () => {
    return samples({
      bd_fat: ['bd_fat.ogg'],
      sn_dub: ['sn_dub.ogg'],
      // ... all 206
    }, '/static/samples/');
  }
});
```

**Dynamic map generation:** Add sample filename list to the `status` WebSocket message (server already scans directories). Client builds the map from that list. No hardcoding needed.

### Parameter mapping

| Tone.js | Strudel |
|---------|---------|
| `playbackRate` | `speed` |
| `finish` (0-1) | `end` (0-1) |
| `Tone.Filter` (cutoff) | `lpf(freq)` / `hpf(freq)` |
| `Tone.Panner` (-1 to 1) | `pan` (0-1) |
| `Tone.Gain` | `gain(value)` |
| `Tone.Reverb` | `room(amount)` + `rsize(size)` |
| `Tone.FeedbackDelay` | `delay(amount)` + `delaytime(t)` + `delayfeedback(fb)` |

## 6. License Change

1. Add `LICENSE` file with AGPL-3.0 text at repo root
2. Update `CLAUDE.md`: remove "Not open source", add "AGPL-3.0"
3. Add AGPL-3.0 header to frontend JS files using Strudel
4. Make GitHub repo public (AGPL requires source availability for network users)
5. Add "Source Code" link in UI footer pointing to repo
6. Safer assumption: whole project (including Python backend) becomes AGPL-3.0

## 7. Phases

### Phase 0: Preparation (no audio changes)
1. Add AGPL-3.0 LICENSE file
2. Add sample filename list to `status` WebSocket message
3. Archive Tone.js tracks as `frontend/tracks/_tone_oracle.js` etc.
4. Keep existing Tone.js working throughout

### Phase 1: Audio engine scaffold
1. Swap CDN script tag to `@strudel/web`
2. Rewrite `audio-engine.js` for Strudel
3. Keep music theory utilities
4. Replace `sampleBank` with `samples()` call
5. Create minimal test track (drone responding to `heat`) to verify pipeline

### Phase 2: Port Oracle
1. Write oracle.js with new track interface
2. Test FM piano fidelity with `s("fm").fmi().fmh(2)`
3. Verify event handling via pattern regeneration
4. Tune gain levels

### Phase 3: Port Mezzanine
1. Drums first (kick, snare, hat, rim) — samples, easy to compare
2. Bass layers (sub, 303)
3. Arp (PluckSynth workaround needed)
4. Pad, deep echo, drift, drone
5. Event handlers
6. Extensive listening at various data values

### Phase 4: Port Just Vibes
1. Same layer-by-layer approach as mezzanine
2. Share drum patterns/utilities with mezzanine

### Phase 5: Cleanup
1. Remove archived Tone.js tracks
2. Rewrite `docs/writing-tracks.md` for Strudel interface
3. Update `CLAUDE.md` architecture section
4. Deploy and test with live market data

## 8. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| FM piano timbre fidelity | HIGH | Test early in Phase 2; fallback to piano sample |
| No PluckSynth (Karplus-Strong) | HIGH | Short bright synth + reverb, or pluck sample |
| Variable-interval loops | MEDIUM | Fixed interval + data-driven skip via `.sometimesBy()` |
| Per-voice parameter control | MEDIUM | Test that per-event `pan`, `fmi`, `gain` work as expected |
| Smooth parameter ramping | MEDIUM | 3s intervals slow enough for stepped changes; use `.lpenv()` if needed |
| `@strudel/web` bundle size | LOW | Measure after integration; split packages + bundler if needed |
| AudioWorklet COOP/COEP headers | UNKNOWN | Test early; update nginx config if needed |
