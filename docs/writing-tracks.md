# Writing Tracks

Tracks are JavaScript files in `frontend/tracks/` that use Strudel (`@strudel/web`) to generate audio in the browser. Each track is an object that receives market data and returns a Strudel pattern.

## Track Interface

```javascript
const myTrack = {
  name: 'my_track',
  label: 'My Track',
  category: 'music',    // 'music' (continuous) or 'alert' (reactive)

  init() {
    // Reset any persistent state (chord index, counters, etc.)
  },

  pattern(data) {
    // Called every 3s with market data. Return a Strudel Pattern or null (silence).
    // Build layers and stack() them.
    const layers = [];
    layers.push(note('c3 e3 g3').s('sine').gain(0.2));
    layers.push(s('bd_fat').struct('t ~ t ~'));
    return stack(...layers).cpm(80 / 4);  // set BPM
  },

  onEvent(type, msg, data) {
    // Handle one-shot events. Return a Pattern to layer on top, or null.
    if (type === 'spike') return s('drum_cymbal_soft').gain(0.1).room(0.6);
    return null;
  },
};

audioEngine.registerTrack('my_track', myTrack);
```

**Key principle: patterns are regenerated, not mutated.** The `pattern(data)` function is called fresh every 3 seconds with new data. It produces a new Pattern object each time. There is no persistent synth state or parameter ramping — the 3-second interval is slow enough that stepped changes sound fine.

**Persistent state** across ticks (e.g., chord index, phrase counter) lives as closure variables or properties on the track object.

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
- `midiToHz(midi)` — Convert MIDI note to Hz. **Use this for all filter cutoff values** — Sonic Pi originals use MIDI note numbers for cutoff
- `noteToStrudel(noteName)` — Convert standard notation to Strudel format (`C#4` → `cs4`, `Bb3` → `bb3`)
- `SCALES` — `{major, minor, major_pentatonic, minor_pentatonic, major7, minor7, m7minus5}` interval arrays

## Sample Bank

206 CC0-licensed OGG samples from Freesound (same set bundled with Sonic Pi) are in `frontend/samples/`. They're registered with Strudel during `initStrudel()` — the server sends the full sample name list in the WebSocket `status` message.

Use samples in patterns directly by name:
```javascript
s('bd_fat').speed(0.85).lpf(midiToHz(70)).gain(0.3)
s('sn_dub').speed(0.9).end(0.3).gain(0.15).room(0.5)
s('drum_cymbal_closed').speed(1.5).end(0.05).hpf(midiToHz(110))
```

## Sonic Pi → Strudel Synth Mapping

The original tracks were authored in Sonic Pi (`sonic_pi/*.rb`). Here's how each Sonic Pi synth maps to Strudel:

| Sonic Pi synth | Strudel equivalent | Notes |
| --- | --- | --- |
| `:piano` | `s('fm')` with low `fmi`, fast `fmdecay` | `hard` → fmi (0.5-1.5), `vel` → decay length. `fmdecay` creates the hammer-strike brightness |
| `:pluck` | `s('triangle')` with short decay + `room` | Approximation of Karplus-Strong. No direct equivalent in superdough |
| `:tb303` | `s('sawtooth')` with `lpf`/`lpq` | Resonant acid bass. Use `lpq` for resonance |
| `:hollow` | `s('triangle')` with `lpf` + high `room` | Breathy band-filtered noise character. Triangle + heavy reverb approximates it |
| `:dark_ambience` | `s('sawtooth')` with heavy `lpf` + `room` | Detuned saw pad |
| `:sine` | `s('sine')` | Direct equivalent |
| samples | `s('sample_name')` | Direct: `s('bd_fat')`, `s('sn_dub')`, etc. |

## Sonic Pi → Strudel Parameter Mapping

| Sonic Pi | Strudel | Notes |
| --- | --- | --- |
| `amp:` | `.gain(value)` | Direct mapping |
| `rate:` | `.speed(value)` | Sample playback rate |
| `finish:` | `.end(value)` | Fraction of sample to play (0-1) |
| `cutoff:` (MIDI) | `.lpf(midiToHz(value))` | Always convert with `midiToHz()` |
| `pan:` (-1 to 1) | `.pan(value)` | Strudel: 0=left, 0.5=center, 1=right |
| `attack:`, `release:` | `.attack(s)`, `.release(s)` | Direct mapping |
| `with_fx :reverb, room:` | `.room(amount)`, `.rsize(size)` | `room` = wet mix, `rsize` = decay time |
| `with_fx :echo, phase:, decay:` | `.delay(wet)`, `.delaytime(s)`, `.delayfeedback(fb)` | |
| `with_fx :lpf, cutoff:` | `.lpf(midiToHz(cutoff))` | |
| `with_fx :hpf, cutoff:` | `.hpf(midiToHz(cutoff))` | |
| `res:` (tb303) | `.lpq(value)` | Filter Q/resonance |

## Strudel Pattern Basics

Common patterns used in existing tracks:

```javascript
// Notes: play a sequence
note('c3 e3 g3').s('sine').gain(0.2)

// Samples: trigger by name
s('bd_fat').speed(0.85).lpf(midiToHz(70))

// Stack layers (play simultaneously)
stack(bassLayer, drumLayer, padLayer)

// Rhythmic structures (boolean patterns)
s('bd_fat').struct('t ~ t ~')      // beats 1 and 3
s('sn_dub').struct('~ t ~ ~')      // beat 2

// Speed up patterns
s('drum_cowbell').struct('~ ~ ~ t ~ ~ t ~').fast(4)  // 16th notes

// Slow down patterns
s('vinyl_hiss').slow(2)  // every 2 cycles (8 beats)

// Probabilistic triggering
s('drum_cymbal_closed').degradeBy(0.6)  // 40% chance of playing

// Random values per event
s('drum_cymbal_closed').speed(rand.range(1.2, 1.8)).gain(rand.range(0.02, 0.06))

// Rests in sequences
note('c3 ~ e3 ~ g3').s('sine')  // ~ = rest

// Set BPM: cycles per minute = BPM / beats_per_cycle
stack(...layers).cpm(80 / 4)  // 80 BPM, 4 beats per cycle

// Panning with LFO
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

- **Sonic Pi originals:** `sonic_pi/*.rb` — The source of truth for musical content. All Strudel tracks are ported from these, using the mastered amp values (with `~nf` normalization factors applied).
- **Archived Tone.js versions:** `frontend/tracks/_tone_*.js` — Previous Tone.js implementations, kept for reference. Underscore prefix means the server skips them.
