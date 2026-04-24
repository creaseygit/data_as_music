# Writing Tracks

Tracks are JavaScript files in `frontend/tracks/` that use Strudel (`@strudel/web` + `@strudel/soundfonts`) to generate audio in the browser. Each track is an object that receives market data and produces audio via one of two modes.

## Track Modes

### Evaluate mode (preferred for faithful strudel.cc reproduction)

The track provides an `evaluateCode(data)` method that returns a strudel code **string**. The audio engine passes it to strudel's `evaluate()` function — the same code path strudel.cc's REPL uses. This handles `$:` pattern labels, `setcpm()`, `.orbit()` isolation, and the transpiler identically.

```javascript
const myTrack = {
  name: "my_track",
  label: "My Track",
  category: "music",
  cpm: 30,  // cycles per minute — must match setcpm() in evaluateCode

  init() {},

  evaluateCode(data) {
    // Return raw strudel code — identical to what you paste into strudel.cc.
    // Use string interpolation to inject data values.
    return `
      setcpm(30);
      $: note("c4 e4 g4").s("piano").gain(${0.2 + (data.heat || 0.3) * 0.3})
      $: s("bd sd bd sd").gain(0.3).orbit(1)
    `;
  },

  onEvent(type, msg, data) {
    // Return a code string for evaluate-mode tracks, or null
    if (type === "spike") {
      const gain = (0.04 + (msg.magnitude || 0.5) * 0.04).toFixed(3);
      return `$: s("<cr:0 ~ ~ ~>").gain(${gain}).room(0.4).orbit(5);`;
    }
    return null;
  },
};

audioEngine.registerTrack("my_track", myTrack);
```

### Pattern mode (legacy)

The track provides a `pattern(data)` method that returns a Strudel Pattern object directly. Simpler but doesn't support `$:`, `setcpm()`, or `.orbit()` — patterns must be combined with `stack().cpm()`.

```javascript
const myTrack = {
  name: "my_track",
  label: "My Track",
  category: "music",
  cpm: 20,  // cycles per minute — must match .cpm() in pattern

  init() {},

  pattern(data) {
    const h = data.heat || 0.3;
    return stack(
      note("<c2 c2 f2 g2>").sound("sawtooth").lpf(400).gain(0.3 + h * 0.2),
      sound("bd_fat").struct("x ~ x ~").gain(0.4),
    ).cpm(20);
  },

  onEvent(type, msg, data) {
    if (type === "spike") return sound("drum_cymbal_soft").gain(0.1).room(0.6);
    return null;
  },
};

audioEngine.registerTrack("my_track", myTrack);
```

**Key principle: patterns are regenerated, not mutated.** Both modes are called fresh every 3 seconds with new data.

**Key principle: music is never interrupted mid-bar.** The audio engine buffers incoming data and defers pattern rebuilds to the next **cycle boundary** (downbeat). Tracks must declare their `cpm` so the engine can calculate timing.

**Critical rules for stable, musical output:**

1. **Declare `cpm` on every track.** The audio engine uses this to calculate cycle boundaries for data buffering. Without `cpm`, updates apply immediately (no boundary alignment).

2. **Never use `Math.random()`** in `pattern()`. JS randomness produces different values on each 3-second rebuild, making the music chaotic. Use Strudel's cycle-deterministic randomness instead: `degradeBy()`, `rand.range()`, `sometimes()`.

3. **Use `<>` mini-notation for progressions**, not JS counters. `note("<a2 a2 f2 g2>")` cycles one value per bar based on the Strudel cycle position — stable across rebuilds.

4. **`struct()` already defines subdivision.** A 16-element struct gives 16th notes natively. Do NOT add `fast()` on top of struct patterns — that creates 64th notes.

5. **Use data values only for parameters** (gain, filter cutoff) and structural decisions (which layers to include). The pattern *structure* (rhythms, note sequences) should be Strudel mini-notation, not JS-computed.

6. **Keep the `$:` block count constant** (evaluate-mode tracks). Strudel assigns positional IDs to anonymous `$:` patterns. If blocks are conditionally omitted, IDs shift and patterns get mismatched on transitions. Instead, always emit every `$:` block and use `$: silence;` as a placeholder when a layer is inactive.

## Data Received

The `pattern(data)` or `evaluateCode(data)` method receives these values every 3 seconds:

```javascript
{
  // ── What's happening ──
  heat: 0.0-1.0,         // Overall market activity (energy)
  trade_rate: 0.0-1.0,   // How frequently people are trading
  spread: 0.0-1.0,       // Order book tightness

  // ── Price & direction ──
  price: 0.0-1.0,        // Current market price (0=No, 1=Yes)
  price_move: -1.0-1.0,  // "Is price moving RIGHT NOW?" — edge-detected, window 45s–8min (scales with sensitivity), saturates at √window-scaled max (~3¢ at 30s, ~12¢ at 8min)
  momentum: -1.0-1.0,    // "What's the trend?" — positive=uptrend, negative=downtrend (sensitivity-scaled window)
  velocity: 0.0-1.0,     // Price excursion over the sens-scaled window (unsigned, max−min, 10¢=1.0)

  // ── Character ──
  volatility: 0.0-1.0,   // Market uncertainty — high=erratic bouncing, low=calm
  tone: 0|1,             // 1=bullish/major, 0=bearish/minor (with hysteresis, won't flicker)
  sensitivity: 0.0-1.0,  // User's sensitivity slider value (optional use)
}
```

### How to think about these signals musically

| Signal | Musical role | Example mapping |
| --- | --- | --- |
| `heat` | **Energy** — how loud/busy should things be? | Volume scaling, layer count, rhythmic density |
| `price` | **Harmonic position** — where are we? | Register, note choice, tension/resolution (0.5=uncertain, 0.9+=resolved) |
| `price_move` | **Phrase trigger** — something is happening NOW | Ascending/descending melodic runs, arpeggios, fills |
| `momentum` | **Section mood** — sustained direction | Build energy during uptrend, pull back during downtrend, sparse when sideways |
| `velocity` | **Pace** — how fast is the market moving? | Tempo feel, rhythmic subdivision |
| `volatility` | **Tension/uncertainty** — erratic vs calm | Dissonance, detuning, filter modulation, tremolo, irregular rhythms |
| `trade_rate` | **Complexity** — how much activity? | Drum pattern complexity, number of instruments, melodic density |
| `spread` | **Liquidity feel** — tight book vs wide gap | Consonance/dissonance, register width |
| `tone` | **Key/mode** — major or minor? | Scale selection, chord quality |

### Signal combinations worth listening for

- **High volatility + low |momentum|** = *indecision* — market is bouncing with no direction. Map to: tension, dissonance, unsettled rhythms.
- **High volatility + high |momentum|** = *breakout* — volatile but going somewhere. Map to: dramatic energy + directional phrases.
- **Low volatility + high |momentum|** = *steady trend* — calm, confident move. Map to: smooth ascending/descending lines.
- **Low volatility + low |momentum|** = *quiet* — nothing happening. Map to: ambient, sparse, waiting.

### Sensitivity

The user's **sensitivity slider** controls how reactive the music is. You don't need to handle this — it's pre-applied before your track receives data:

- **Activity signals** (`heat`, `trade_rate`, `spread`): amplitude is scaled — high sensitivity inflates small values, low sensitivity crushes them.
- **Window signals** (`price_move`, `momentum`, `velocity`, `volatility`): the analysis **window length** changes — high sensitivity = short window (reactive, catches quick moves), low sensitivity = long window (smooth, only sustained trends). This is like switching between short and long moving averages on a trading chart.

## Events

The `onEvent(type, msg, data)` method handles one-shot events. Return type depends on track mode:
- **Evaluate-mode tracks**: return a code string (appended to base `evaluateCode()` output), or `null`
- **Pattern-mode tracks**: return a Pattern object (stacked with base `pattern()` output), or `null`

| Event | `msg` fields | Meaning |
| --- | --- | --- |
| `spike` | `magnitude: 0.0–1.0` | Heat spike — magnitude tells you how big (small threshold breach vs huge jump) |
| `price_step` | `direction: 1\|-1`, `magnitude: 0.0–1.0` | Per-tick raw price jump — direction + size. Distinct from the continuous `price_move` signal. |
| `resolved` | `result: 1\|-1` | Market resolved (1=Yes won, -1=No won) |

Use `msg.magnitude` to scale your response — a tiny spike and a massive spike can sound different:

```javascript
// Evaluate-mode example:
onEvent(type, msg, data) {
  if (type === "spike") {
    const gain = (0.04 + (msg.magnitude || 0.5) * 0.04).toFixed(3);
    return `$: s("<cr:0 ~ ~ ~>").gain(${gain}).room(0.4).orbit(4);`;
  }
  return null;
}

// Pattern-mode example:
onEvent(type, msg, data) {
  if (type === "spike") {
    const gain = 0.04 + (msg.magnitude || 0.5) * 0.04;
    return sound("cr:0").gain(gain).room(0.4);
  }
  return null;
}
```

## Track Metadata

Add metadata as comments at the top of the file for the server to parse:
```javascript
// category: 'music', label: 'My Track Name'
```

## Adding a New Track

Tracks are **auto-discovered and dynamically loaded** — no `index.html` changes needed:
1. Copy `frontend/tracks/_template.js` to `frontend/tracks/yourname.js`
2. Rename the track, fill in voices and patterns (the template is fully annotated)
3. Restart the server (it scans `frontend/tracks/` on startup)
4. The browser loads track scripts dynamically based on the server's discovered list

## Voice Gain System (Mastering Support)

All music tracks must declare a `voices` object for per-voice gain control from the mastering page. See `frontend/tracks/_template.js` for the full annotated pattern, or [`docs/development/mastering-and-sandbox.md`](development/mastering-and-sandbox.md) for the design spec.

```javascript
voices: {
  kick:   { label: "Kick",   default: 1.0 },
  bass:   { label: "Bass",   default: 1.0 },
  chords: { label: "Chords", default: 1.0 },
  melody: { label: "Melody", default: 1.0 },
},
gains: {},
getGain(voice) {
  return this.gains[voice] ?? this.voices[voice]?.default ?? 1.0;
},
```

In each voice code generator, multiply `.gain()` values by `this.getGain('voiceName')`:
```javascript
const g = (0.35 * energy * this.getGain('kick')).toFixed(3);
```

Use consistent voice IDs across tracks: `kick`, `snare`, `hihat`, `perc`, `bass`, `chords`, `melody`, `pad`, `fx`.

## Music Utilities

`audio-engine.js` provides helpers (independent of Strudel):
- `getScaleNotes(root, scaleType, count, octaves)` — Get scale notes
- `midiToNote(midi)` / `noteToMidi(note)` — Convert between MIDI numbers and note names (`C#4`, `Bb3`)
- `noteToStrudel(noteName)` — Convert standard notation to Strudel format (`C#4` → `cs4`, `Bb3` → `bb3`)
- `SCALES` — `{major, minor}` interval arrays

## Sounds

Tracks use Strudel's built-in oscillators, sampled instruments, and multiple loaded sample libraries:

1. **Salamander Grand Piano** (`"piano"`) — Multi-velocity acoustic grand piano from CDN
2. **Dirt-Samples** — 200+ sample banks from TidalCycles (drums, cymbals, percussion)
3. **uzu-drumkit** — Default drum sounds: `bd`, `sd`, `hh`, `oh`, `cr`, `rd` (ride), `rim` (rimshot), `cp`, `cb`, `ht`, `mt`, `lt`
4. **VCSL** — Orchestral percussion (CC0 license)
5. **Tidal Drum Machines** — Classic drum machine samples (TR-808, LinnDrum, etc.)
6. **GM Soundfonts** (`"gm_*"`) — 128 General MIDI instruments via `@strudel/soundfonts` (loaded from webaudiofontdata CDN on demand)

```javascript
note("c4 e4 g4").sound("piano").gain(0.3).room(0.5)        // acoustic piano
note("c2 e2 a2").sound("gm_acoustic_bass").gain(0.3)       // GM upright bass
note("<c2 f2>").sound("sawtooth").lpf(200).gain(0.1)        // synth oscillator
sound("rd").gain(0.25)                                       // ride cymbal (uzu-drumkit)
sound("cr:0").speed(0.95).gain(0.06).end(0.3)               // crash cymbal (Dirt-Samples)
```

## Sound Reference

### Sampled Instruments (acoustic)

| Sound | Usage | Notes |
| --- | --- | --- |
| `"piano"` | `.sound("piano")` | Salamander Grand Piano (CDN). Multi-velocity, ~3 semitones per sample |
| `"gm_acoustic_bass"` | `.sound("gm_acoustic_bass")` | GM upright bass soundfont. Use with `note()` for walking bass lines |
| `"gm_epiano1"` | `.sound("gm_epiano1")` | GM Rhodes-style electric piano |
| `"gm_vibraphone"` | `.sound("gm_vibraphone")` | GM vibraphone |
| `"gm_tenor_sax"` | `.sound("gm_tenor_sax")` | GM tenor saxophone |

### Drum Samples (Dirt-Samples + uzu-drumkit)

| Sound | Source | Usage | Notes |
| --- | --- | --- | --- |
| `"bd"` | uzu-drumkit / Dirt | `.sound("bd")` | Kick drum (Dirt-Samples has 24 variants via `bd:0`–`bd:23`) |
| `"sd"` | uzu-drumkit / Dirt | `.sound("sd")` | Snare drum |
| `"hh"` | uzu-drumkit / Dirt | `.sound("hh")` | Closed hi-hat |
| `"oh"` | uzu-drumkit / Dirt | `.sound("oh")` | Open hi-hat |
| `"rd"` | uzu-drumkit | `.sound("rd")` | **Ride cymbal**. Default strudel ride |
| `"rim"` | uzu-drumkit | `.sound("rim")` | **Rimshot / cross-stick** |
| `"cr"` | uzu-drumkit / Dirt | `.sound("cr")` | Crash cymbal (Dirt-Samples has 6 variants `cr:0`–`cr:5`) |
| `"cp"` | uzu-drumkit / Dirt | `.sound("cp")` | Hand clap |
| `"cb"` | uzu-drumkit / Dirt | `.sound("cb")` | Cowbell |
| `"ho"` | `.sound("ho")` | Open hi-hat (6 variants) |
| `"cc"` | `.sound("cc")` | Crash cymbal (6 variants) |
| `"cb"` | `.sound("cb")` | Cowbell |

### Oscillators (synthetic)

| Sound | Usage | Notes |
| --- | --- | --- |
| `"sine"` | `.sound("sine")` | Pure sine. Good for sub bass |
| `"sawtooth"` | `.sound("sawtooth")` | Saw wave. Good for bass lines, pads with `.lpf()` |
| `"triangle"` | `.sound("triangle")` | Triangle wave. Good for plucks, arps, pads |
| `"pink"` | `.sound("pink")` | Pink noise synth. Good for vinyl hiss / texture |
## Strudel Effects Reference

| Effect | Usage | Notes |
| --- | --- | --- |
| Low-pass filter | `.lpf(hz)` | Frequency in Hz |
| High-pass filter | `.hpf(hz)` | |
| Reverb | `.room(amount)`, `.rsize(size)` | `room` = wet mix, `rsize` = decay time |
| Delay/echo | `.delay(wet)`, `.delaytime(s)`, `.delayfeedback(fb)` | |
| Pan | `.pan(value)` | 0=left, 0.5=center, 1=right |
| Envelope | `.attack(s)`, `.release(s)` | |
| Filter resonance | `.lpq(value)` | |

## Strudel Pattern Basics

Common patterns used in existing tracks:

```javascript
// ── Basic patterns ──
note("c3 e3 g3").sound("sine").gain(0.2)       // synth notes
sound("bd_fat").speed(0.85).lpf(370).gain(0.3)  // sample trigger
note("c4 e4 g4").sound("piano").room(0.3)        // sampled piano

// ── Stack layers ──
stack(
  sound("bd_fat").struct("x ~ x ~").gain(0.4),
  sound("sn_dub").struct("~ x ~ ~").gain(0.15),
  note("c3 e3 g3").sound("sine").gain(0.2)
).cpm(20)  // 80 BPM (= 20 cycles per minute)

// ── Cycling / Progressions ──
note("<a2 a2 f2 g2>").sound("sine")   // <> = one per cycle (chord roots)
note("[c3 e3 g3 e3]").sound("sine")   // [] = all in one cycle (arp)

// ── Rhythms ──
sound("bd_fat").struct("x ~ x ~")      // 4 positions = quarter notes
sound("sn_dub").struct("~ x ~ ~")      // snare on beat 2
sound("drum_cowbell").struct("~ ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ x ~ ~")  // 16th notes
// WARNING: struct element count = subdivision. Do NOT add fast() on top.

// ── Duration weights ──
note("[a2@3 ~ e3 d3 a2@2]")  // a2=3/8, rest=1/8, e3=1/8, d3=1/8, a2=2/8

// ── Speed / Slow ──
sound("vinyl_hiss").slow(2)   // every 2 cycles
sound("hh").fast(4)           // 4× speed (for simple patterns WITHOUT struct)

// ── Probabilistic (cycle-deterministic, safe for rebuilds) ──
sound("hh").degradeBy(0.6)               // 40% chance of playing
sound("hh").gain(rand.range(0.05, 0.15)) // random gain per event
sound("hh").speed(rand.range(1.2, 1.8))  // random speed per event

// ── Rests ──
note("c3 ~ e3 ~ g3").sound("sine")  // ~ = silence

// ── Pan with LFO ──
.pan(sine.range(0.3, 0.7).slow(4))
```

## Existing Tracks

### late_night_in_bb.js
Jazz piano trio with two market paradigms, 120 BPM. **Uses evaluate mode** — strudel code built dynamically with data-driven interpolation. **8 voices:** `bass`, `melody`, `ride`, `hihat`, `comp`, `ghostSnare`, `crossStick`, `kick`, `fill` — all with mastering gain support via `getGain()`. **Two paradigms driven by `tone`:** Bullish (tone=1) plays Bb major changes (Cm7→F7→BbΔ7→EbΔ7, ii-V-I-IV) with ascending bass walks and ascending melodies. Bearish (tone=0) plays G minor changes (Am7b5→D7→Gm7→Cm7, iiø-V-i-iv) with descending bass walks and descending melodies. **Intensity axis:** `trade_rate` (60%) + `velocity` (40%) compute an intensity score quantized into 3 bands (low/mid/high). Each band selects from pre-composed bass (16 bars x 6 variants), melody (8 bars x 6 variants), and percussion patterns of increasing complexity. Low: quarter-note walks, sparse comping, simple hi-hat. Mid: eighth-note approaches, ghost snares, cross-stick. High: chromatic runs, kick bombs, turnaround fills, dense comping. Heat still controls overall energy/gain scaling. **Momentum** sustains melody during trends — melody plays when `price_move` is active OR `|momentum| > 0.1`, so sustained trends keep the melody alive even after the edge-detected move decays. **Volatility** drives timbral uncertainty: piano comping gets slight detuning (`.speed(rand.range(...))`), delay feedback increases (more wash/echo), and bass LPF drops (darker, muddier tone). All layers use `.orbit()` for bus isolation. Spike events trigger crash cymbal scaled by event magnitude.

### digging_in_the_markets.js
Dusty, mellow lo-fi hip hop beats, 80 BPM (cpm 20). **Uses evaluate mode.** **8 voices:** `kick`, `snare`, `hihat`, `keys`, `bass`, `melody`, `texture`, `pad` — all with mastering gain support via `getGain()`. **Harmonic system driven by `tone`:** Bullish (tone=1) plays Bb major; bearish (tone=0) plays G minor — flat keys chosen for that warm lo-fi register. Rhodes-style keys comp with data-driven voicings. **Heat controls layer density:** sparse pulses at low heat, fuller kits and pickups at higher heat. **Intensity bands** (same `trade_rate`/`velocity` formula as `late_night_in_bb`) drive drum complexity: simple rim shots at band 0, swung 8th-note hats at band 1, dropout 16ths at band 2. **Momentum** drives melodic contour — sparse pentatonic runs that follow the trend direction. **Volatility** adds reverb depth, detuning, and wobble. **Price** tints the global filter for warmth. Vinyl texture and warm sine bass throughout. Spike events add crash; price_move events trigger melodic runs.

### weather_vane.js
Melody-only price direction alert, `category: "alert"`, 20 cpm. **Uses evaluate mode.** **1 voice:** `melody` (vibraphone, `gm_vibraphone.n(4)` for the GeneralUserGS variant so high-register runs don't hit the corrupt default-variant zones). Dual signal use: **`price_moving`** is the gate (true iff price ticked ≥0.05¢ this cycle — false kills the voice immediately) and **`price_delta_cents`** is the magnitude (rolling cents delta → scale length: 3-note at 0.5–2¢, 5-note at 2–5¢, 8-note at >5¢). This pairing solves the "rolling delta keeps firing after the move ends" problem — the gate stops the voice the moment the price holds, while the cents magnitude still reflects the size of the move that just happened. Sign of the delta picks ascending vs descending phrases; scale follows `tone` (C4:major / C4:minor). Sensitivity scales the server-side lookback (15s at max → 5min at min). Phrases are packed into the start of the cycle followed by silence so notes land tightly grouped (~0.2s apart). No `onEvent()` ornamentation — single-voice by design.

## Legacy References

- **Sonic Pi tracks** and **earlier Strudel tracks** (`mezzanine.js`, `jazz_alerts.js`, `oracle.js`, `poolside_house.js`, `signal_berlin.js`, `diagnostic.js`) were removed from the repo. Git history has them if needed.
