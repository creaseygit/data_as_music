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
  price_delta: -1.0-1.0, // Signed per-cycle price change (sensitivity-adjusted)
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

## Music Utilities

`audio-engine.js` provides helpers (independent of Strudel):
- `getScaleNotes(root, scaleType, count, octaves)` — Get scale notes
- `midiToNote(midi)` / `noteToMidi(note)` — Convert between MIDI numbers and note names (`C#4`, `Bb3`)
- `midiToHz(midi)` — Convert MIDI note to Hz. **Use this for all filter cutoff values** (MIDI note numbers, not Hz)
- `noteToStrudel(noteName)` — Convert standard notation to Strudel format (`C#4` → `cs4`, `Bb3` → `bb3`)
- `SCALES` — `{major, minor, major_pentatonic, minor_pentatonic, major7, minor7, m7minus5}` interval arrays

## Sounds

Tracks use Strudel's built-in oscillators (`"sine"`, `"sawtooth"`, `"triangle"`) and a sampled **piano** loaded from the VCSL Salamander Grand Piano on CDN:
```javascript
note("c4 e4 g4").sound("piano").gain(0.3).room(0.5)
note("<c2 f2>").sound("sawtooth").lpf(200).gain(0.1)
```

## Synth Reference

| Sound | Usage | Notes |
| --- | --- | --- |
| `"piano"` | `.sound("piano")` | Built-in sampled piano (CDN). Use for all piano sounds |
| `"sine"` | `.sound("sine")` | Pure sine. Good for sub bass |
| `"sawtooth"` | `.sound("sawtooth")` | Saw wave. Good for bass lines, pads with `.lpf()` |
| `"triangle"` | `.sound("triangle")` | Triangle wave. Good for plucks, arps, pads |
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
Piano alert track. Returns pattern only when `|price_delta| > 0.1`, otherwise `null` (silence). FM synth voices play ascending/descending motifs (2-6 notes from scale). C major when bullish, A minor when bearish. Volume very low (matching Sonic Pi `set_volume! 0.3`). From `sonic_pi/oracle.rb`.

### mezzanine.js
Massive Attack/Teardrop-inspired ambient dub, 80 BPM. Am → Am → F → G progression (8-bar cycle). Layers: sub bass (sine), bass (sawtooth/tb303 phrases), arp (triangle with octave shifts), kick + ghost patterns (bd_fat), snare (sn_dub), hi-hat (probabilistic), rim (16-step cowbell pattern), vinyl dust, pad/dub wash (triangle + reverb), deep echo (sawtooth + delay), price drift (triangle through reverb→delay), ambient drone. Events trigger FM piano arpeggios and cymbal crashes. From `sonic_pi/mezzanine.rb`.

### just_vibes.js
Lo-fi hip hop, 75 BPM. Bullish: Fmaj7→Em7→Dm7→Cmaj7. Bearish: Dm7→Bbmaj7→Gm7→Am7. Same sample-based drum palette as mezzanine. Price drift uses FM piano. Deep echo at random 10-14 beat intervals. From `sonic_pi/just_vibes.rb`.

## Legacy References

- **Sonic Pi originals** were removed from the repo (Strudel migration complete). Git history has them if needed.
