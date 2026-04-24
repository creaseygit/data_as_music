# Mastering & Sandbox — Design Spec

> **Status: Implemented.** All phases complete. Both pages are live at `/master` and `/sandbox`. Music tracks (`late_night_in_bb`, `digging_in_the_markets`) are migrated to the voice gain system. This document is the original design spec retained for reference.

Two pages for tuning tracks and exploring their dynamic range.

| Page | URL | Purpose |
| ---- | --- | ------- |
| **Mastering** | `/master` | Per-voice gain sliders against live (or pinned) market data. Mix the track, export levels as JSON. |
| **Sandbox** | `/sandbox` | Simulated market data. Override every signal with sliders/presets to hear a track across its full range. |

Both pages share the same audio engine and track loader as the main page. No server-side changes needed — all new functionality is client-side.

---

## 1. Voice Gain System (Track Spec Update)

### Problem

Tracks currently bake all `.gain()` values directly into pattern code. There is no way to adjust the relative level of individual voices (bass, melody, drums, etc.) without editing the track source.

### Solution: Voice-level gain multipliers

Each track declares its **voices** as structured metadata. Each voice has a gain multiplier (default `1.0`) that scales all `.gain()` values for that voice during code generation. The mastering page reads the voice list, renders sliders, and writes multiplier values back to the track object. Changes take effect at the next cycle boundary (already built into the audio engine).

### Why this approach

| Considered | Verdict | Reason |
| ---------- | ------- | ------ |
| **Orbit-based Web Audio GainNodes** | Rejected | Strudel manages its own internal effects chains per orbit — intercepting them depends on undocumented internals. Also, multiple voices often share an orbit (e.g. all drums on orbit 4), so orbit-level gain can't separate kick from hihat. |
| **Voice gain multipliers in track code** | **Adopted** | Granularity beyond orbits, pre-effects gain (correct for mixing), no Strudel internals dependency, trivially serializable, works with both evaluate and pattern modes. |

### Updated track interface

Every music track must declare a `voices` object and implement `getGain()`:

```javascript
const myTrack = {
  name: "my_track",
  label: "My Track",
  category: "music",
  cpm: 30,

  // ── Voice declarations ──
  // The mastering page reads this to render sliders.
  // Keys are internal IDs, labels are human-readable.
  voices: {
    kick:   { label: "Kick",   default: 1.0 },
    bass:   { label: "Bass",   default: 1.0 },
    chords: { label: "Chords", default: 1.0 },
    melody: { label: "Melody", default: 1.0 },
  },

  // ── Runtime gain state ──
  // The mastering page writes here: track.gains.kick = 0.8
  // Persists across pattern rebuilds (object reference stays alive).
  gains: {},

  // ── Gain helper ──
  // Each voice code generator calls this to get its current multiplier.
  getGain(voice) {
    return this.gains[voice] ?? this.voices[voice]?.default ?? 1.0;
  },

  evaluateCode(data) {
    // When computing .gain() values, multiply by this.getGain('voice'):
    //   .gain(${(0.45 * energy * this.getGain('bass')).toFixed(3)})
  },
};
```

### Gain multiplier semantics

- `1.0` = the track author's original level (no change)
- `0.0` = muted
- `> 1.0` = boosted (allow up to 2.0 for headroom)
- Applied **pre-effects** — scales the dry signal before reverb/delay, which is musically correct (louder dry signal = proportionally louder wet signal)
- Applied at code generation time, so the gain is baked into the Strudel pattern string — no Web Audio graph changes needed

### Voice naming conventions

Use consistent voice IDs across tracks where applicable:

| ID | Typical use |
| -- | ----------- |
| `kick` | Kick drum |
| `snare` | Snare / ghost snare / cross-stick |
| `hihat` | Hi-hats and cymbals |
| `perc` | Other percussion (shakers, claps, rimshots) |
| `bass` | Bass instrument |
| `chords` | Chord comping (piano, Rhodes, pad) |
| `melody` | Lead melody |
| `pad` | Atmospheric pad / drone |
| `fx` | One-shot effects, fills |

Tracks don't need all of these — only declare voices that exist. A simple track might have 3 voices; a complex one might have 10. The mastering page renders whatever the track declares.

---

## 2. Mastering Page (`/master`)

### Purpose

Load a track, connect to a live market (or pinned market), and adjust per-voice gain levels in real time. Export the tuned levels as JSON.

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Track: [dropdown]    Market: [current / browse]     │
│  Status: Playing ▶ / Stopped ■                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Master Volume  ━━━━━━━━━━━━━━━━━●━━━━━━  0.7       │
│                                                      │
│  ── Voices ──────────────────────────────────────    │
│                                                      │
│  Kick      [S] [M]  ━━━━━━━━━━━●━━━━━━━━  1.00     │
│  Bass      [S] [M]  ━━━━━━━━●━━━━━━━━━━━  0.85     │
│  Chords    [S] [M]  ━━━━━━━━━━━━━●━━━━━━  1.10     │
│  Melody    [S] [M]  ━━━━━━━━━━━━━━━━●━━━  1.30     │
│  Hi-hat    [S] [M]  ━━━━━━━━━━●━━━━━━━━━  0.90     │
│  Pad       [S] [M]  ━━━━━━━━━━━━●━━━━━━━  1.00     │
│                                                      │
│  [Reset All]  [Export JSON]  [Import JSON]           │
│                                                      │
├─────────────────────────────────────────────────────┤
│  Now playing: BTC 5min Up/Down  │  Heat: 0.42       │
│  Sensitivity: ━━━━━━━●━━━━━━━━  │  Price: 0.67      │
└─────────────────────────────────────────────────────┘
```

### Controls

| Control | Behaviour |
| ------- | --------- |
| **Voice slider** | Range 0.0–2.0, step 0.01, default from `track.voices[id].default`. Writes to `track.gains[id]`. |
| **[S] Solo** | Mutes all other voices. Multiple solos = only soloed voices play. |
| **[M] Mute** | Sets gain to 0 for that voice. Visual indicator (greyed out slider). |
| **Reset All** | Resets all gains to defaults from `track.voices`. |
| **Export JSON** | Downloads a `.json` file (see format below). |
| **Import JSON** | Loads a `.json` file, applies gains to matching voice IDs. |
| **Master Volume** | Same as main page — controls the Web Audio master GainNode. |

### Solo/Mute implementation

Solo and mute are **UI-only state** — they don't persist into the JSON export (the export captures the slider values, not solo/mute toggles). Implementation:

```javascript
// Effective gain calculation:
function effectiveGain(voiceId) {
  if (muteState[voiceId]) return 0;
  if (anySoloed && !soloState[voiceId]) return 0;
  return track.gains[voiceId] ?? track.voices[voiceId]?.default ?? 1.0;
}
```

The track's `getGain()` method needs to be aware of the mastering page's solo/mute state. The mastering page overrides `track.getGain` to route through its own logic.

### Data flow

```
Market data ──→ WebSocket ──→ audioEngine.onMarketData()
                                    │
                              cycle boundary
                                    │
                              track.evaluateCode(data)
                                    │
                              track.getGain('bass')  ←── mastering slider
                                    │
                              Strudel evaluate()
                                    │
                              audio output
```

No changes to the audio engine broadcast loop, WebSocket protocol, or server. The mastering page simply manipulates `track.gains` — the existing cycle-boundary system picks up changes.

---

## 3. Sandbox Page (`/sandbox`)

### Purpose

Explore a track's full dynamic range by simulating market conditions. Override all data signals with sliders and presets — no live market connection needed.

### UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Track: [dropdown]                                   │
│  Status: Playing ▶ / Stopped ■                       │
├──────────────────────┬──────────────────────────────┤
│  ── Data Signals ──  │  ── Presets ──               │
│                      │                               │
│  heat       ━━●━━  0.42  │  [Bull Run]    [Crash]  │
│  price      ━━━●━  0.67  │  [Dead Market] [Chaos]  │
│  price_move ━━━━●  0.00  │  [Breakout]    [Calm]   │
│  momentum   ━━━●━  0.30  │                          │
│  velocity   ━━●━━  0.25  │  ── Sweeps ──            │
│  trade_rate ━━━●━  0.40  │  [Sweep heat 0→1 10s]   │
│  spread     ━●━━━  0.15  │  [Sweep price 0→1 10s]  │
│  volatility ━━●━━  0.20  │  [Sweep all 0→1 15s]    │
│  tone       [Major/Minor] │                          │
│  sensitivity ━━●━  0.50  │                          │
│                      │                               │
├──────────────────────┴──────────────────────────────┤
│  ── Voice Levels (read-only or adjustable) ──       │
│  [same per-voice sliders as mastering page]          │
│                                                      │
│  Master Volume  ━━━━━━━━●━━━━━━━━━  0.7             │
└─────────────────────────────────────────────────────┘
```

### Data simulation

The sandbox page **does not connect to the WebSocket**. Instead, it constructs a synthetic data object from its sliders and pushes it to the audio engine:

```javascript
function pushSyntheticData() {
  const data = {
    heat: sliders.heat.value,
    price: sliders.price.value,
    price_move: sliders.price_move.value,  // -1 to 1
    momentum: sliders.momentum.value,       // -1 to 1
    velocity: sliders.velocity.value,
    trade_rate: sliders.trade_rate.value,
    spread: sliders.spread.value,
    volatility: sliders.volatility.value,
    tone: toneToggle.value,                 // 0 or 1
    sensitivity: sliders.sensitivity.value,
  };
  audioEngine.onMarketData(data);
}

// Push on every slider change (debounced to cycle boundary by audio engine)
```

### Presets

Each preset sets all sliders to predefined values:

| Preset | heat | price | price_move | momentum | velocity | trade_rate | spread | volatility | tone |
| ------ | ---- | ----- | ---------- | -------- | -------- | ---------- | ------ | ---------- | ---- |
| **Bull Run** | 0.8 | 0.85 | 0.6 | 0.8 | 0.6 | 0.7 | 0.1 | 0.3 | 1 |
| **Crash** | 0.9 | 0.15 | -0.8 | -0.9 | 0.8 | 0.9 | 0.6 | 0.8 | 0 |
| **Dead Market** | 0.05 | 0.5 | 0.0 | 0.0 | 0.05 | 0.05 | 0.2 | 0.1 | 1 |
| **Chaos** | 0.7 | 0.5 | 0.0 | 0.0 | 0.5 | 0.6 | 0.5 | 0.95 | 0 |
| **Breakout** | 0.85 | 0.7 | 0.7 | 0.7 | 0.7 | 0.8 | 0.15 | 0.6 | 1 |
| **Calm Trend** | 0.3 | 0.6 | 0.2 | 0.5 | 0.2 | 0.2 | 0.1 | 0.1 | 1 |

### Sweeps

Animate a single signal (or all signals) from 0 to 1 (or -1 to 1 for signed) over a configurable duration. Implementation:

```javascript
function sweep(signal, from, to, durationMs) {
  const startTime = performance.now();
  function tick() {
    const t = Math.min(1, (performance.now() - startTime) / durationMs);
    sliders[signal].value = from + (to - from) * t;
    pushSyntheticData();
    if (t < 1) requestAnimationFrame(tick);
  }
  tick();
}
```

### Event simulation

Buttons to fire synthetic events:

- **[Fire Spike]** — sends `{event: "spike", magnitude: <slider>}` to `audioEngine.handleEvent()`
- **[Fire Price Step +]** — sends `{event: "price_step", direction: 1, magnitude: <slider>}`
- **[Fire Price Step -]** — sends `{event: "price_step", direction: -1, magnitude: <slider>}`
- **[Fire Resolved Yes]** — sends `{event: "resolved", result: 1}`
- **[Fire Resolved No]** — sends `{event: "resolved", result: -1}`

### Voice sliders on sandbox

The sandbox page also includes per-voice gain sliders (same as mastering). This lets musicians adjust levels while exploring data ranges — the two concerns (data simulation + gain tuning) are usable together.

---

## 4. JSON Export/Import Format

### Gain levels export (from mastering page)

```json
{
  "format": "dam.fm/mastering",
  "version": 1,
  "track": "late_night_in_bb",
  "timestamp": "2026-04-01T12:34:56Z",
  "voices": {
    "bass": 0.85,
    "melody": 1.10,
    "comp": 0.90,
    "ride": 1.00,
    "hihat": 0.75,
    "ghostSnare": 0.60,
    "crossStick": 1.00,
    "kick": 1.15,
    "fill": 0.80
  }
}
```

### Import behaviour

- Voice IDs that exist in the file but not in the track are silently ignored
- Voice IDs that exist in the track but not in the file keep their current value
- Track name in the file is checked — warn (but don't block) if it doesn't match the loaded track

### Future: applying gains to track source

When a mastering export is finalized, the gains can be baked into the track's `voices` defaults:

```javascript
voices: {
  bass: { label: "Bass", default: 0.85 },  // was 1.0, mastered to 0.85
  // ...
}
```

This is a manual step for now (edit the `.js` file). A future PR-creation flow could automate this.

---

## 5. Track Migration Guide

### What changes for existing tracks

All existing music tracks (`late_night_in_bb`, `digging_in_the_markets`) need to:

1. **Add `voices` object** — declare every independently-controllable voice
2. **Add `gains` object** — empty `{}`, populated at runtime by mastering page
3. **Add `getGain()` method** — standard helper (same on every track)
4. **Multiply `.gain()` values by `getGain()`** in each voice code generator

### Example migration (late_night_in_bb bass voice)

**Before:**
```javascript
function bassCode(tone, intBand, energy, volatility) {
  // ...
  return `
$: note(\`${notes}\`)
  .s("gm_acoustic_bass")
  .gain(\`${gains}\`)       // ← gains baked in, no multiplier
  .orbit(3);
`;
}
```

**After:**
```javascript
function bassCode(tone, intBand, energy, volatility, gainMul) {
  // ...
  const scaledGains = scaleGains(BASS_GAINS, energy * gainMul);
  return `
$: note(\`${notes}\`)
  .s("gm_acoustic_bass")
  .gain(\`${scaledGains}\`)  // ← energy * voice gain multiplier
  .orbit(3);
`;
}

// In evaluateCode():
code += bassCode(tone, intBand, energy, volQ, this.getGain('bass'));
```

---

## 6. Template Track

A starter template lives at `frontend/tracks/_template.js`. Musicians copy this file, rename it, and fill in their voices and patterns. See the template file for the full annotated example.

---

## 7. Implementation Order

All phases are complete:

| Phase | Scope | Status |
| ----- | ----- | ------ |
| **1** | Track spec update: `voices`, `gains`, `getGain()`. `_template.js` created. | Done |
| **2** | Migrate `late_night_in_bb` (8 voices) and `digging_in_the_markets` (8 voices) to voice spec. | Done |
| **3** | Build `/master` page (voice sliders, solo/mute, JSON export/import). | Done |
| **4** | Build `/sandbox` page (data simulation, presets, sweeps, event triggers). | Done |
| **5** | Cross-page navigation between main, mastering, and sandbox. | Done |

---

## 8. Resolved Design Decisions

- **Sandbox includes voice sliders** — yes, the sandbox has full voice gain controls (same as mastering page).
- **Preset values** — implemented as specified in the preset table above. Can be tuned by ear.
- **URL state** — not yet implemented for mastering/sandbox pages (future enhancement).
- **Mobile layout** — not yet optimized for touch (future enhancement).
