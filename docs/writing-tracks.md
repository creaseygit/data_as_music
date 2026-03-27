# Writing Tracks

Tracks are JavaScript files in `frontend/tracks/` that use Strudel (`@strudel/web`) to generate audio in the browser. Each track is an object that receives market data and returns a Strudel pattern.

## Track Interface

```javascript
const myTrack = {
  name: "my_track",
  label: "My Track",
  category: "music",  // "music" (continuous) or "alert" (reactive)

  init() {},

  pattern(data) {
    // Called every 3s with market data. Return a Strudel Pattern or null (silence).
    const h = data.heat || 0.3;

    return stack(
      // bass — chord roots cycle via <>
      note("<c2 c2 f2 g2>").sound("sawtooth")
        .lpf(400).gain(0.3 + h * 0.2),

      // kick & snare
      sound("bd_fat").struct("x ~ x ~").gain(0.4),
      sound("sn_dub").struct("~ x ~ ~").gain(0.15).room(0.5),

      // piano melody
      note("c4 eb4 g4 ~ c4 ~ bb3 g3").sound("piano")
        .gain(0.3).room(0.3)
    ).cpm(20);  // 80 BPM (= 20 cycles per minute)
  },

  onEvent(type, msg, data) {
    // One-shot events. Return a Pattern to layer on top, or null.
    if (type === "spike") return sound("drum_cymbal_soft").gain(0.1).room(0.6);
    return null;
  },
};

audioEngine.registerTrack("my_track", myTrack);
```

**Key principle: patterns are regenerated, not mutated.** The `pattern(data)` function is called fresh every 3 seconds with new data. It produces a new Pattern object each time. Calling `.play()` on a new pattern seamlessly swaps it on Strudel's singleton cyclist — the cycle position is preserved, not reset.

**Critical rules for stable, musical output:**

1. **Never use `Math.random()`** in `pattern()`. JS randomness produces different values on each 3-second rebuild, making the music chaotic. Use Strudel's cycle-deterministic randomness instead: `degradeBy()`, `rand.range()`, `sometimes()`.

2. **Use `<>` mini-notation for progressions**, not JS counters. `note("<a2 a2 f2 g2>")` cycles one value per bar based on the Strudel cycle position — stable across rebuilds.

3. **`struct()` already defines subdivision.** A 16-element struct gives 16th notes natively. Do NOT add `fast()` on top of struct patterns — that creates 64th notes.

4. **Use data values only for parameters** (gain, filter cutoff) and structural decisions (which layers to include). The pattern *structure* (rhythms, note sequences) should be Strudel mini-notation, not JS-computed.

## Data Received

The `pattern(data)` method receives:
```javascript
{
  heat: 0.0-1.0,        // Composite market activity (sensitivity-adjusted)
  price: 0.0-1.0,       // Current market price
  price_delta: -1.0-1.0, // Signed per-cycle (3s) price change (sensitivity-adjusted)
  price_move: -1.0-1.0,  // Edge-detected price change (30s window, only non-zero during active movement)
  velocity: 0.0-1.0,     // Price velocity (sensitivity-adjusted)
  trade_rate: 0.0-1.0,   // Trades per minute (sensitivity-adjusted)
  spread: 0.0-1.0,       // Bid-ask spread (sensitivity-adjusted)
  tone: 0|1,             // 1=bullish/major, 0=bearish/minor
  sensitivity: 0.0-1.0   // Raw sensitivity value (optional use)
}
```

Activity metrics are **pre-adjusted by the user's sensitivity setting**.

## Events

The `onEvent(type, msg, data)` method handles one-shot events:
- `type === 'spike'` — Heat delta exceeded threshold
- `type === 'price_move'` — `msg.direction` is `1` (up) or `-1` (down)
- `type === 'resolved'` — `msg.result` is `1` (Yes won) or `-1` (No won)

Return a Strudel Pattern to layer on top of the current pattern, or `null` for no response.

## Track Metadata

Add metadata as comments at the top of the file for the server to parse:
```javascript
// category: 'music', label: 'My Track Name'
```

## Adding a New Track

Tracks are **auto-discovered and dynamically loaded** — no `index.html` changes needed:
1. Create `frontend/tracks/yourname.js` with the metadata comment and `registerTrack()` call
2. Restart the server (it scans `frontend/tracks/` on startup)
3. The browser loads track scripts dynamically based on the server's discovered list

## Music Utilities

`audio-engine.js` provides helpers (independent of Strudel):
- `getScaleNotes(root, scaleType, count, octaves)` — Get scale notes
- `midiToNote(midi)` / `noteToMidi(note)` — Convert between MIDI numbers and note names (`C#4`, `Bb3`)
- `midiToHz(midi)` — Convert MIDI note to Hz. **Use this for all filter cutoff values** (MIDI note numbers, not Hz)
- `noteToStrudel(noteName)` — Convert standard notation to Strudel format (`C#4` → `cs4`, `Bb3` → `bb3`)
- `SCALES` — `{major, minor, major_pentatonic, minor_pentatonic, major7, minor7, m7minus5}` interval arrays

## Sounds

Tracks use Strudel's built-in oscillators, sampled instruments, and two loaded sample libraries:

1. **Salamander Grand Piano** (`"piano"`) — Multi-velocity acoustic grand piano from CDN
2. **Dirt-Samples** — 200+ sample banks from TidalCycles (drums, cymbals, percussion)
3. **GM Soundfonts** (`"gm_*"`) — General MIDI instruments, lazy-loaded from CDN on first use

```javascript
note("c4 e4 g4").sound("piano").gain(0.3).room(0.5)        // acoustic piano
note("c2 e2 a2").sound("gm_acoustic_bass").gain(0.3)       // upright bass
note("<c2 f2>").sound("sawtooth").lpf(200).gain(0.1)        // synth oscillator
sound("cr:0").speed(0.95).gain(0.06).end(0.3)               // ride cymbal
```

## Sound Reference

### Sampled Instruments (acoustic)

| Sound | Usage | Notes |
| --- | --- | --- |
| `"piano"` | `.sound("piano")` | Salamander Grand Piano (CDN). Multi-velocity, ~3 semitones per sample |
| `"gm_acoustic_bass"` | `.sound("gm_acoustic_bass")` | GM upright bass. Use with `note()` for walking bass lines |
| `"gm_epiano1"` | `.sound("gm_epiano1")` | GM Rhodes-style electric piano |
| `"gm_epiano2"` | `.sound("gm_epiano2")` | GM DX7-style electric piano |
| `"gm_vibraphone"` | `.sound("gm_vibraphone")` | GM vibraphone |
| `"gm_acoustic_guitar_nylon"` | `.sound("gm_acoustic_guitar_nylon")` | GM nylon guitar |
| `"gm_tenor_sax"` | `.sound("gm_tenor_sax")` | GM tenor saxophone |

### Drum Samples (Dirt-Samples)

| Sound | Usage | Notes |
| --- | --- | --- |
| `"bd"` | `.sound("bd")` | Kick drum (24 variants via `bd:0`–`bd:23`) |
| `"sd"` | `.sound("sd")` | Snare drum (2 variants) |
| `"hh"` | `.sound("hh")` | Closed hi-hat (13 variants) |
| `"cr"` | `.sound("cr")` | **Ride cymbal** (6 variants `cr:0`–`cr:5`). Use for ride patterns |
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
| Low-pass filter | `.lpf(hz)` | Use `midiToHz()` if converting from MIDI note numbers |
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

### oracle.js
Piano chord alert that fires on price moves. Uses `price_move` (edge-detected, only non-zero during active movement): magnitude sets chord count (2-5), sign sets direction (ascending=up, descending=down). Silent when price is flat. C major when bullish (tone=1), A minor when bearish (tone=0). Uses pre-defined triad chord runs via polyphonic mini-notation `[deg,deg+2,deg+4]`.

### jazz_alerts.js
Jazz trio with reactive piano. 100 BPM (cpm 25). All acoustic samples: ride cymbal (`cr` samples, 2-layer spang-a-lang), walking upright bass (`gm_acoustic_bass` GM soundfont), Salamander grand piano voicings. Ride uses quarter-note pulse on all 4 beats plus triplet skip notes on beats 2 and 4 (12-element grid). Hi-hat foot chicks on 2 and 4. Feathered kick barely audible. Snare ghost notes on triplet partials (65% `degradeBy`). Bass walks chord tones with chromatic approaches — Cmaj7→Am7→Dm7→G7 (major) or Am7→Dm7→Em7→Am7 (minor). Piano 7th-chord voicings trigger on `price_move`. Energy-gated: cross-stick, ride bell (`cr:3` high speed), snare bombs, hi-hat splashes. Consistent room reverb across all layers for cohesive acoustic space.

### mezzanine.js
Massive Attack trip-hop, 80 BPM. Am → Am → Fm → Gm progression (4-bar cycle). Half-time beat: kick on 1 and "and" of 2 (`bd:3`), snare on 3 only (`sd:1`), 8th-note hi-hats with `degradeBy` for human feel. Deep saw bass with root-fifth phrases, sub bass (sine) on roots. Pad triads (triangle + reverb), vinyl hiss. Activity-gated: open hat, ghost kicks, dub echo stab (delay/feedback), cowbell rim clicks. Tone switches between natural minor (bullish) and darker voicings (bearish). Events trigger piano arpeggios and cymbal crashes.

### jazz_trio.js
Jazz piano trio over Autumn Leaves changes, 120 BPM (cpm 30). All acoustic samples: ride cymbal (`cr` 2-layer spang-a-lang), walking upright bass (`gm_acoustic_bass`), Salamander grand piano comping and melody. 16-bar walking bass (two choruses with variations). 8-bar syncopated comping with rootless voicings (3rd, 5th, 7th) embedded directly in mini-notation rhythms. **Directional price expression**: `price_move` sign drives ascending/descending scale runs in both single-note melody and 7th-chord voicings (Oracle-style `getScaleNotes` approach). Magnitude controls run length (2-8 melody notes, 2-5 chords). Bb major (tone=1) or G minor (tone=0) — full progression switch across bass, comping, and directional layers. **Activity scaling**: all layer gains scale with `heat` — very quiet at low activity, full energy at high. Energy-gated layers add complexity progressively: ghost snare (h>0.2), cross-stick (tr>0.25), ride bell (h>0.5), snare bombs (tr>0.5), hi-hat splashes (v>0.4), kick bombs (h>0.6), turnaround fill (h>0.7). `spread` controls room reverb spaciousness. `price` controls bass LPF brightness. Comping gain ducks when directional layers are active.

## Legacy References

- **Sonic Pi originals** were removed from the repo (Strudel migration complete). Git history has them if needed.
