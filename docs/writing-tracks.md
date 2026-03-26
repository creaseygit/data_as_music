# Writing Tracks

Tracks are JavaScript files in `frontend/tracks/` that use Tone.js to generate audio in the browser. Each track is a class that receives market data and produces music.

## Track Interface

```javascript
class MyTrack {
  constructor(destination)  // Create synths, loops, connect to Tone.js destination
  start()                   // Start loops (engine ensures Transport is running)
  stop()                    // Stop and dispose all synths/loops
  update(data)              // Called every 3s with market data object
  onEvent(type, msg)        // Handle one-shot events (spike, price_move, resolved)
}

// Register with the audio engine
audioEngine.registerTrack('my_track', MyTrack);
```

**Audio isolation:** The `destination` passed to the constructor is a per-track gain node, not the master output directly. When the user switches tracks, the engine disconnects this node to instantly silence all lingering audio (delay tails, orphaned sample players, etc.). Tracks should connect all audio chains to `destination` — never directly to `Tone.Destination`.

## Data Received

The `update(data)` method receives:
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

Activity metrics (heat, velocity, trade_rate, spread) are **pre-adjusted by the user's sensitivity setting** — tracks don't need to handle sensitivity themselves.

## Events

The `onEvent(type, msg)` method handles one-shot events:
- `type === 'spike'` — Heat delta exceeded threshold
- `type === 'price_move'` — `msg.direction` is `1` (up) or `-1` (down)
- `type === 'resolved'` — `msg.result` is `1` (Yes won) or `-1` (No won)

## Track Metadata

Add metadata as comments or in the export for the track selector UI:
```javascript
// category: 'music', label: 'My Track Name'
```
Category is `"music"` (continuous generative) or `"alert"` (reactive). The server reads these from the file to populate the track selector.

## Music Utilities

`audio-engine.js` provides helpers:
- `getScaleNotes(root, scaleType, count, octaves)` — Get scale notes (e.g., `getScaleNotes('C4', 'major', 8, 2)`)
- `midiToNote(midi)` / `noteToMidi(note)` — Convert between MIDI numbers and note names (supports sharps and flats: `C#4`, `Bb3`, `Eb4`)
- `midiToHz(midi)` — Convert MIDI note to Hz. **Use this for all filter cutoff values** — Sonic Pi uses MIDI note numbers for cutoff, not Hz (e.g., `cutoff: 70` → `midiToHz(70)` ≈ 370 Hz)
- `SCALES` — `{major, minor, major_pentatonic, minor_pentatonic, major7, minor7, m7minus5}` interval arrays

## Sample Bank

206 CC0-licensed OGG samples from Freesound (same set bundled with Sonic Pi) are in `frontend/samples/`. Use the `sampleBank` API to load and play them:

```javascript
// In constructor: preload samples you need
const samples = ['bd_fat', 'sn_dub', 'drum_cymbal_closed', 'vinyl_hiss'];
sampleBank.preload(samples).then(() => { this.samplesReady = true; });

// Load a buffer for use with Tone.Player
const buf = await sampleBank.load('bd_fat');
const player = new Tone.Player(buf).connect(destination);
player.playbackRate = 0.85;  // Sonic Pi rate: parameter
player.start(time);

// Or get a pre-wired player
const player = await sampleBank.getPlayer('bd_fat', destination);
```

Sample names match Sonic Pi exactly (without the colon prefix): `bd_fat`, `sn_dub`, `drum_cymbal_closed`, `drum_cowbell`, `drum_cymbal_soft`, `vinyl_hiss`, etc.

## Sonic Pi → Tone.js Synth Mapping

| Sonic Pi synth | Tone.js equivalent | Notes |
| --- | --- | --- |
| `:piano` | `Tone.FMSynth` (harmonicity: 2–3) | `hard` → modulationIndex, `vel` → envelope decay |
| `:pluck` | `Tone.PluckSynth` | `coeff` 0.1–0.2 → `resonance` 0.88–0.95 (see gotcha below) |
| `:tb303` | `Tone.MonoSynth` (sawtooth) | Match filter envelope and Q/resonance |
| `:hollow` | Triangle `PolySynth` + pink noise layer | Triangle alone is too clean; add bandpass-filtered pink noise that swells with each note for the breathy, resonant character (see pattern below) |
| `:dark_ambience` | `Tone.Synth` (fatsawtooth, spread: 20) | Detuned saw pair + heavy LPF + reverb |
| `:sine` | `Tone.Synth` (sine) | Direct equivalent |
| samples (`:bd_fat` etc.) | `Tone.Player` via `sampleBank` | See "Sample Playback" section for full parameter mapping |

## Critical: Sample Playback Parameters

Sonic Pi samples have parameters that **must** be ported to Tone.js or drums will sound terrible. The three most important are `finish` (truncation), `cutoff` (filtering), and `pan` (stereo position).

### `finish:` — Sample truncation

Sonic Pi's `finish:` parameter plays only a fraction of the sample (0.0–1.0). **This is essential for tight percussion.** Without it, a snare plays its full waveform (~1s) instead of a crisp 0.25s hit.

```javascript
// Sonic Pi: sample :sn_dub, finish: 0.25
// Tone.js: schedule a stop at finish fraction of sample duration
const buf = await sampleBank.load('sn_dub');
const p = new Tone.Player(buf);
p.start(time);
const finishDur = (buf.duration / p.playbackRate) * 0.25;
Tone.Transport.scheduleOnce(() => { p.stop(); }, time + finishDur);
```

Typical `finish` values from the Sonic Pi tracks:
| Sample | finish | Effect |
| --- | --- | --- |
| `sn_dub` (snare) | 0.15–0.30 | Tight dub snare hit |
| `drum_cowbell` (rim) | 0.03–0.04 | Tiny percussive tick |
| `drum_cymbal_closed` (hat) | 0.04–0.05 | Crisp hi-hat tick |

### `cutoff:` — Sample filtering

Sonic Pi's `cutoff:` applies a lowpass filter to the sample (MIDI note number, not Hz). Create dedicated `Tone.Filter` nodes and route samples through them.

```javascript
// Sonic Pi: sample :bd_fat, cutoff: 70
// Tone.js: route through a pre-built LPF
this.kickFilter = new Tone.Filter({
  frequency: midiToHz(70), type: 'lowpass'
}).connect(destination);
// Then connect sample player → kickFilter instead of → destination
```

Typical kick `cutoff` values: 70 (main), 60 (ghost), 55 (sub ghost). Lower = darker, tighter.

### `pan:` — Stereo position

Use `Tone.Panner` for per-hit stereo placement. Important for hats, rim, and pad notes.

```javascript
const panner = new Tone.Panner(rrand(-0.3, 0.3)).connect(destination);
gain.connect(panner);
```

### Standard `_playSample` helper

Both mezzanine and just_vibes use a consistent `_playSample(name, time, opts)` helper that handles all these parameters. When writing new tracks, copy this pattern:

```javascript
_playSample(name, time, opts = {}) {
  // opts: { amp, playbackRate, finish, pan, destination }
  sampleBank.load(name).then((buf) => {
    const p = new Tone.Player(buf);
    if (opts.playbackRate) p.playbackRate = opts.playbackRate;

    const dest = opts.destination || this.dest;
    let tail = dest;
    let panner = null;
    if (opts.pan !== undefined) {
      panner = new Tone.Panner(opts.pan).connect(tail);
      tail = panner;
    }
    const gain = new Tone.Gain(opts.amp || 1).connect(tail);
    p.connect(gain);

    p.start(time);

    // Truncate at finish point
    if (opts.finish !== undefined) {
      const finishDur = (buf.duration / (opts.playbackRate || 1)) * opts.finish;
      Tone.Transport.scheduleOnce(() => { try { p.stop(); } catch(e) {} }, time + finishDur);
    }

    // Auto-dispose
    const dur = opts.finish
      ? (buf.duration / (opts.playbackRate || 1)) * opts.finish
      : buf.duration / (opts.playbackRate || 1);
    setTimeout(() => {
      try { p.dispose(); gain.dispose(); if (panner) panner.dispose(); } catch(e) {}
    }, (dur + 1.5) * 1000);
  });
}
```

## `:hollow` Synth Pattern

Sonic Pi's `:hollow` is a band-pass filtered noise synth with resonance — not a simple oscillator. Approximate it by layering a triangle `PolySynth` with a pink noise source filtered through a bandpass that swells with each note:

```javascript
// In constructor:
this.padSynth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' },
  envelope: { attack: 2.5, decay: 1, sustain: 0.5, release: 5 },
}).connect(this.padFilter);
this.padNoiseFilter = new Tone.Filter({ frequency: midiToHz(58), type: 'bandpass', Q: 2 }).connect(this.padReverb);
this.padNoiseGain = new Tone.Gain(0).connect(this.padNoiseFilter);
this.padNoise = new Tone.Noise('pink').connect(this.padNoiseGain);

// In start(): this.padNoise.start();

// When playing a pad note, swell the noise layer:
this.padNoiseGain.gain.setValueAtTime(0, time);
this.padNoiseGain.gain.linearRampToValueAtTime(amp * 0.12, time + 2);
this.padNoiseGain.gain.linearRampToValueAtTime(0, time + 5);
```

## `:pluck` Resonance Gotcha

Sonic Pi's `:pluck` `coeff` parameter (0–1) controls the lowpass filter coefficient in the Karplus-Strong feedback loop. Lower values = more high-frequency damping per cycle = darker but still ringing tone. Tone.js `PluckSynth.resonance` (0–1) controls sustain length — higher = longer ring.

**The mapping is not linear or inverse.** Sonic Pi `coeff: 0.1–0.2` produces a moderately damped but clearly audible pluck. Map this to `resonance: 0.88–0.95` in Tone.js. Setting `resonance: 0.1–0.2` (as a naive direct mapping would) kills the note almost instantly.

## Tone.js Patterns

Common patterns used in existing tracks:
- **Loops:** `new Tone.Loop(callback, interval)` — equivalent to Sonic Pi's `live_loop`
- **Synths:** `Tone.FMSynth` (piano), `Tone.MonoSynth` (tb303-style), `Tone.PluckSynth`, `Tone.Player` (samples)
- **Effects:** `Tone.Reverb`, `Tone.FeedbackDelay`, `Tone.Filter`
- **Parameter updates:** Use `.rampTo()` for smooth transitions, direct `.set()` for instant changes
- **One-shots:** `synth.triggerAttackRelease(note, duration, time, velocity)`
- **Filter cutoffs:** Always use `midiToHz()` when porting from Sonic Pi cutoff values

## Existing Tracks

### oracle.js
Piano alert track. Single `Tone.Loop` (3s interval). FMSynth voices with per-note panning play ascending/descending motifs (2–6 notes) on price movement > 0.1. C major when bullish, A minor when bearish. `hard` and `vel` parameters drive FM modulation depth and envelope. Volume scales with activity (velocity + trade_rate).

### mezzanine.js
Massive Attack/Teardrop-inspired ambient dub, 80 BPM. Am → Am → F → G progression. 12+ concurrent loops: sub bass (sine), bass (MonoSynth/tb303), arp (PluckSynth with octave shifts), kick + kick ghost (bd_fat samples), snare (sn_dub), hi-hat (drum_cymbal_closed through HPF), rim (drum_cowbell), vinyl dust (vinyl_hiss), pad/dub wash (triangle + reverb), deep echo (fatsawtooth + delay), price drift (PluckSynth through reverb→echo→LPF), ambient drone. Heat inversely drives pad density. Price drives all filter cutoffs via `midiToHz()`. Events trigger FMSynth piano arpeggios and cymbal crashes.

### just_vibes.js
Lo-fi hip hop, 75 BPM. Key: F major / D minor. Chord clock syncs all harmonic loops via `chordIdx`. Same sample-based drum palette as mezzanine. Bullish: Fmaj7→Em7→Dm7→Cmaj7. Bearish: Dm7→Bbmaj7→Gm7→Am7. Pad uses self-scheduling for random 6-8 beat intervals. Deep echo uses fatsawtooth through delay→LPF at random 10-14 beat intervals.

## Legacy Sonic Pi Tracks

The original `.rb` tracks remain in `sonic_pi/` for reference and local Sonic Pi development. They are not deployed to the web server. See `sonic_pi/oracle.rb`, `sonic_pi/mezzanine.rb`, `sonic_pi/just_vibes.rb`.
