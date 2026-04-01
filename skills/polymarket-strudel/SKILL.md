---
name: strudel
description: Write data-driven music tracks for Polymarket DJ using Strudel. Use when creating, modifying, or debugging tracks that sonify live prediction market data into music.
argument-hint: genre, mood, or modification request
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Strudel — Polymarket DJ Track Author

## Overview

Strudel is a browser-based live-coding music environment (JavaScript port of TidalCycles). The Polymarket DJ platform uses Strudel to sonify live prediction market data — turning price movements, trading activity, and market sentiment into music.

**Your job**: Write JavaScript track files that receive market data every 3 seconds and return Strudel code strings. The platform handles audio rendering, data delivery, and cycle-boundary alignment. Music is never interrupted mid-bar.

## When to Use This Skill

- Creating new tracks from scratch ("write a house track that reacts to market data")
- Modifying existing tracks ("make the bass respond to volatility")
- Debugging tracks ("the melody cuts out when momentum is high")
- Explaining how data maps to musical parameters

For comprehensive Strudel syntax, see [references/strudel-language.md](references/strudel-language.md).
For tonal/harmonic functions, see [references/tonal-harmony.md](references/tonal-harmony.md).
For genre-specific techniques, see [references/genre-styles.md](references/genre-styles.md).

---

## Track Architecture

Tracks live in `frontend/tracks/`. Each is an IIFE returning an object, registered via `audioEngine.registerTrack()`.

### Evaluate Mode (preferred)

The track returns a **Strudel code string** — the same code you'd paste into strudel.cc. The engine passes it to `evaluate()`.

For the full annotated template, see [examples/_template.js](examples/_template.js).

```javascript
// ── My Track ─────────────────────────────────────
// One-line description of the track's musical concept.
// category: 'music', label: 'My Track'

const myTrack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  // Quantize helper (reduces pattern rebuilds)
  function q(v, step) { return Math.round(v / step) * step; }

  // Voice code generators — one function per voice
  function kickCode(energy, gainMul) {
    const g = (0.35 * energy * gainMul).toFixed(3);
    return `$: s("bd bd bd bd").gain(${g}).orbit(4);\n`;
  }

  function bassCode(tone, energy, gainMul) {
    const g = (0.30 * energy * gainMul).toFixed(3);
    const notes = tone === 1 ? "C2 E2 F2 G2" : "A1 C2 D2 E2";
    return `$: note("${notes}").s("sawtooth").lpf(400).gain(${g}).orbit(3);\n`;
  }

  return {
    name: "my_track",
    label: "My Track",
    category: "music",
    cpm: 30,  // MUST match setcpm() in evaluateCode

    // Voice declarations — mastering page renders per-voice gain sliders
    voices: {
      kick: { label: "Kick", default: 1.0 },
      bass: { label: "Bass", default: 1.0 },
    },

    // Runtime gain state (mastering page writes here)
    gains: {},

    // Returns current gain multiplier for a voice
    getGain(voice) {
      return this.gains[voice] ?? this.voices[voice]?.default ?? 1.0;
    },

    init() {
      _cachedCode = null;
      _cachedKey = null;
    },

    evaluateCode(data) {
      const h = q(data.heat || 0, 0.05);
      const tone = data.tone !== undefined ? data.tone : 1;

      // Include gain values in cache key so slider changes bust the cache
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      const energy = 0.4 + h * 0.6;
      let code = "setcpm(30);\n";
      code += kickCode(energy, this.getGain('kick'));
      code += bassCode(tone, energy, this.getGain('bass'));

      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        const gain = (0.04 + (msg.magnitude || 0.5) * 0.04).toFixed(3);
        return `$: s("<cr:0 ~ ~ ~>").gain(${gain}).room(0.4).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("my_track", myTrack);
```

### Pattern Mode (legacy)

Returns a Strudel Pattern object directly. Simpler but doesn't support `$:`, `setcpm()`, or `.orbit()`.

```javascript
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
```

---

## Critical Rules

1. **Declare `cpm` on every track** and match it with `setcpm()` in evaluateCode. The engine uses this for cycle-boundary alignment.

2. **Never use `Math.random()`**. JS randomness produces different values on every 3-second rebuild. Use Strudel's cycle-deterministic randomness: `degradeBy()`, `rand.range()`, `sometimes()`, `perlin`.

3. **Use `<>` for progressions**, not JS counters. `note("<a2 a2 f2 g2>")` cycles deterministically based on Strudel's cycle clock — stable across rebuilds.

4. **Keep `$:` block count constant**. Strudel assigns positional IDs to anonymous `$:` patterns. If blocks are conditionally omitted, IDs shift and patterns mismatch. Emit every `$:` block always; use `$: silence;` as placeholder for inactive layers.

5. **Data drives parameters, not structure**. Pattern rhythms and note sequences should be Strudel mini-notation. Data values drive gain, filter cutoff, layer selection, intensity bands — never compute rhythms in JS.

6. **`struct()` defines subdivision**. A 16-element struct gives 16th notes natively. Do NOT add `.fast()` on top — that creates 64th notes.

7. **Multiply all `.gain()` values by `getGain('voiceName')`** for mastering page support. The mastering UI writes per-voice gain multipliers to `track.gains`. Every voice's gain must flow through `getGain()`.

8. **Declare `voices`** on every track. The mastering page reads this to render per-voice sliders. Use consistent IDs: `kick`, `snare`, `hihat`, `perc`, `bass`, `chords`, `melody`, `pad`, `fx`, `counter`.

9. **Include gain values in the cache key** so mastering slider changes bust the cache and rebuild the pattern immediately.

10. **Extract voice code into separate functions**. One function per voice, each receiving a `gainMul` parameter from `getGain()`. This keeps `evaluateCode()` readable and each voice testable in isolation.

---

## Design Principles

These are hard-won lessons from listening to tracks in production. Follow them closely.

### 1. Silence Is a Layer

This platform is an **alert system that uses music**. When the market is quiet, the music must be quiet — not just lower volume, but fewer layers, simpler patterns, near-silence. A listener should barely notice the track during low-activity periods, then be drawn in when something moves.

**The full dynamic range matters.** If `heat` is low and `trade_rate` is near zero, strip the track to almost nothing — maybe a faint pad or a single muted chord every few bars. Don't just turn gain down on a full arrangement; actually remove layers:

```javascript
// BAD: Everything plays, just quiet
const energy = 0.1 + h * 0.9;
code += bassLayer(energy);    // still playing at 0.1
code += drumLayer(energy);    // still playing at 0.1
code += melodyLayer(energy);  // still playing at 0.1

// GOOD: Layers peel away as activity drops
if (h < 0.15) {
  // Near-silent: just a ghost of the pad, everything else off
  code += '$: silence;\n';  // bass
  code += '$: silence;\n';  // drums
  code += '$: silence;\n';  // melody
  code += padLayer(0.05);   // barely audible
} else if (h < 0.35) {
  // Minimal: bass and pad only
  code += bassLayer(energy);
  code += '$: silence;\n';  // drums still off
  code += '$: silence;\n';  // melody still off
  code += padLayer(energy);
}
```

Design every track so that **consecutive low-activity rebuilds converge toward silence**, not toward a quiet-but-busy loop. The listener is waiting for news — don't exhaust their attention with sound that carries no information.

### 2. Melodies Must Not Be Repetitive

Tracks play for **hours**. A static 4-bar melody that ignores data becomes maddening within minutes. Every melodic element must either:

- **Be driven by data** so it changes as the market changes, or
- **Use Strudel's cycle-deterministic generative techniques** for built-in variation

**Techniques for melodic freshness (all cycle-deterministic, rebuild-safe):**

```javascript
// Rotate the starting note each cycle — 4 cycles before the pattern repeats
note("0 2 4 6").scale("C:minor").iter(4)

// Forward then backward — doubles effective length
note("0 2 4 6 7").scale("C:minor").palindrome()

// Random note choice per cycle (deterministic, not Math.random)
note("[c3|e3|g3|a3] [d3|f3|a3|b3]")

// Probabilistic ornamentation
note("0 2 4 6").scale("C:minor")
  .sometimes(x => x.add(note(7)))  // octave jump 50% of the time
  .rarely(x => x.add(note(2)))     // step up 25% of the time

// Layer a time-shifted variation on itself
note("0 2 4 6").scale("C:minor")
  .off(1/8, x => x.add(note(2)).gain(0.5))

// Every N cycles, apply a transformation
note("0 2 4 6").scale("C:minor")
  .every(3, x => x.rev())           // reverse every 3rd cycle
  .every(5, x => x.fast(2))         // double-time every 5th cycle

// Random dropout — different notes vanish each cycle
note("0 1 2 3 4 5 6 7").scale("C:minor").degradeBy(0.3)

// Weighted random sound selection per event
wchoose(["piano", 8], ["gm_vibraphone", 2])
```

**Combine these.** A melody that uses `.iter(4).sometimes(rev).degradeBy(0.2)` won't truly repeat for many cycles. The goal is a melody that feels composed but never quite the same twice.

**Map data to melodic parameters** — don't just use data for gain:
- `momentum` → melodic contour direction (see Design Principles §4)
- `volatility` → `.degradeBy()` amount (uncertain market = more fragmented melody)
- `price` → note range or octave (high price = brighter register)
- `trade_rate` → subdivision (`.fast()` or pattern density)

### 3. Price Direction Must Be Audible

This is a data sonification platform. A listener should be able to **tell by ear whether the market is going up or down**. This requires more than register shifts or major/minor mode — it requires **directional melodic contour**.

When momentum is positive, melodic phrases should literally move upward. When negative, downward. This applies to every pitched layer:

**Melody — pre-compose ascending and descending phrase shapes:**

```javascript
// Momentum selects phrase direction — the SHAPE of the line, not just a transposition
const momSign = mom >= 0 ? 1 : -1;

// Ascending phrases for uptrend
const melodyUp = "[0 2 4 6] [2 4 6 7] [4 6 7 9] [6 7 9 11]";
// Descending phrases for downtrend
const melodyDown = "[11 9 7 6] [9 7 6 4] [7 6 4 2] [6 4 2 0]";
// Neutral/flat for low momentum
const melodyFlat = "[0|2] ~ [4|6] ~ [7|4] ~ [2|0] ~";

const melodyPattern = Math.abs(mom) < 0.15 ? melodyFlat
  : momSign > 0 ? melodyUp : melodyDown;

note(melodyPattern).scale("C4:major")
```

**Bass — walking direction follows the market:**

```javascript
// Bass walks UP on uptrend, DOWN on downtrend
const bassUp   = "<[C2 D2 E2 F2] [A2 B2 C3 D3] [D2 E2 F2 G2] [G2 A2 B2 C3]>";
const bassDown = "<[C3 B2 A2 G2] [A2 G2 F2 E2] [D3 C3 B2 A2] [G2 F2 E2 D2]>";
const bassFlat = "<C2 A2 D2 G2>";  // static roots when sideways
```

**Chord root motion — ascending vs descending progressions:**

```javascript
// Bullish: roots move upward (C → D → E → F)
const chordsRising  = "<C^7 Dm9 Em7 F^7>";
// Bearish: roots move downward (C → Bb → Ab → G)
const chordsFalling = "<Cm7 Bbm7 Ab^7 Gm7>";
```

**Why this works:** Humans intuitively associate rising pitch with "up" and falling pitch with "down." A `.scaleTranspose(2)` shifts everything up but doesn't change the *shape* — the listener hears higher notes, not an upward *movement*. Directional contour is what creates the sensation of motion.

**Combine with `tone`:** Use `tone` (0/1) for major/minor quality and `momentum` sign for contour direction. These are independent dimensions:
- Bullish + uptrend = major ascending (bright, optimistic)
- Bullish + downtrend = major descending (easing off, still positive)
- Bearish + uptrend = minor ascending (recovering, hopeful tension)
- Bearish + downtrend = minor descending (things getting worse)

### 4. Percussion Must Have Life

Even genres that demand steady four-on-the-floor kicks need **micro-variation** in the supporting percussion. Perfectly uniform hi-hats sound mechanical and lifeless over long listening sessions.

**Techniques for percussive life:**

```javascript
// Velocity humanization with perlin noise (smooth, natural)
s("hh*8").gain(perlin.range(0.15, 0.35))

// Probabilistic ghost notes and accents
s("hh*16")
  .gain(perlin.range(0.1, 0.3))
  .sometimes(x => x.gain(0.5))     // random accents
  .rarely(x => x.ply(2))           // occasional flam/double

// Rotating emphasis pattern
s("hh*8").gain(".3 .15 .25 .15 .3 .15 .2 .15")
  .iter(4)                          // shifts accent each cycle

// Euclidean rhythms for organic feel
s("rim").struct("x(3,8)")           // 3 hits across 8 slots
s("cp").struct("x(5,12)")          // asymmetric, shifting

// Every N cycles, swap in a variation
s("hh*8").every(4, x => x.struct("x(5,8)"))
  .every(7, x => x.fast(2).degradeBy(0.4))

// Hi-hat open/closed interplay
stack(
  s("hh*8").gain(perlin.range(0.15, 0.3)),
  s("oh").struct("~ x ~ ~").degradeBy(0.3).gain(0.2)
)
```

**Map data to percussion character:**
- `trade_rate` → Euclidean density (`s("hh").struct("x(${pulses},16)")`)
- `velocity` → subdivision (8ths vs 16ths)
- `volatility` → `.degradeBy()` or probability of fills
- `heat` → number of active percussion layers (not just gain)

---

## Data Signals

Every 3 seconds, `evaluateCode(data)` receives:

### Continuous Signals

| Signal | Range | Musical Role | Mapping Ideas |
|--------|-------|-------------|---------------|
| `heat` | 0–1 | **Energy** | Volume, layer count, rhythmic density, arrangement fullness |
| `price` | 0–1 | **Harmonic position** | Register, note choice. 0.5 = max tension. 0.9+ = resolution. <0.2 = doom |
| `price_move` | -1–1 | **Phrase trigger** | Melodic runs, arpeggios, fills. Only non-zero during active movement (30s window). Momentary gestures. |
| `momentum` | -1–1 | **Section mood** | Build energy on uptrend, pull back on downtrend. Sustained — works for section-level decisions. |
| `velocity` | 0–1 | **Pace** | Subdivision, tempo feel, rhythmic urgency |
| `volatility` | 0–1 | **Tension/uncertainty** | Dissonance, detuning, filter wobble, tremolo, irregular rhythms |
| `trade_rate` | 0–1 | **Complexity** | Drum density, voice count, melodic ornamentation |
| `spread` | 0–1 | **Liquidity feel** | Wide intervals vs tight clusters, consonance vs dissonance |
| `tone` | 0 or 1 | **Key/mode** | 1 = bullish/major. 0 = bearish/minor. Has hysteresis — won't flicker. |

### The Four Market Moods

| Volatility | \|Momentum\| | State | Musical Character |
|-----------|------------|-------|-------------------|
| Low | Low | *Quiet* | Ambient, sparse, patient. Waiting for news. |
| Low | High | *Steady trend* | Smooth directional phrases. Walking bass, ascending lines. |
| High | Low | *Indecision* | Tension, dissonance, nervous energy. Rhythmic instability. |
| High | High | *Breakout* | Maximum drama with clear direction. The moment everyone watches. |

### Other Combinations

- **High heat + low price_move** = churning. Busy rhythms, static harmony.
- **price ≈ 0.5 + high volatility** = genuine uncertainty. Dissonant, unresolved, suspended chords.
- **price > 0.9 + low volatility** = decided. Resolution, consonance, finality.
- **Momentum sign flip** = trend reversal. Key change, section break, dramatic shift.

### Events

`onEvent(type, msg, data)` fires for one-shot moments. Return a code string (evaluate mode) or Pattern (pattern mode), or `null`.

| Event | msg fields | Musical Use |
|-------|-----------|-------------|
| `spike` | `magnitude: 0–1` | Crash, accent, dramatic hit. Scale intensity with magnitude. |
| `price_move` | `direction: 1\|-1`, `magnitude: 0–1` | Melodic run, arpeggio, fill. Direction = up/down. |
| `resolved` | `result: 1\|-1` | Finale. Market answered the question. 1 = Yes won, -1 = No won. |

---

## Track Design Workflow

### 1. Understand the Request
- Genre/style (house, jazz, ambient, techno, etc.)
- Mood (dark, uplifting, tense, minimal, etc.)
- Which data signals to emphasize
- Complexity level (simple alert vs full arrangement)

### 2. Choose CPM
CPM = cycles per minute. For 4/4 time: `cpm = BPM / 4` (one cycle = one bar of 4 beats).
- Jazz trio at 120 BPM → `cpm: 30`
- House at 124 BPM → `cpm: 31`
- Ambient (slow) → `cpm: 10–15`

### 3. Map Data to Music
Design your signal routing before writing code. **Every layer must have a condition under which it falls silent** — there is no "always on":

| Layer | Active when | Driven by | Silent when |
|-------|------------|-----------|-------------|
| Bass | `heat > 0.2` | `tone` (key), `heat` (gain), `volatility` (LPF), **`momentum` (walking direction)** | Low activity — pad carries alone |
| Drums | `heat > 0.3` | `heat` (gain), `trade_rate` + `velocity` (complexity band) | Market sleeping — no rhythm needed |
| Pad/Comp | `heat > 0.1` | `tone` (chord quality), `heat` (gain), `volatility` (detuning), **`momentum` (root motion direction)** | Last to go, first to return |
| Melody | `\|momentum\| > 0.2` or `heat > 0.5` | **`momentum` (contour direction)**, `tone` (scale), `volatility` (fragmentation) | Must use generative techniques (see Design Principles §2) |
| Texture | `volatility > 0.3` | `volatility` (gain), `spread` (filter) | Calm markets |
| Events | On trigger | `spike` (magnitude), `price_move` (direction + magnitude) | Always conditional |

**The goal**: at minimum data values, only the faintest pad (or nothing) is audible. At maximum, every layer is active and rich.

### 4. Design Intensity Bands
Quantize activity into 2–3 bands using `trade_rate` and `velocity`:

```javascript
const rawIntensity = 0.6 * tradeRate + 0.4 * velocity;
const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
```

Pre-compose patterns for each band:
- **Band 0 (low)**: Quarter notes, sparse, simple rhythms
- **Band 1 (mid)**: Eighth notes, ghost notes, more voices
- **Band 2 (high)**: Dense subdivision, fills, chromatic movement

### 5. Write the Code
Structure every track the same way. Extract voice code into separate functions, pass `getGain()` multipliers:

```javascript
// Voice code generators (outside the return object)
function bassLayer(tone, intBand, energy, volQ, gainMul) {
  const g = (0.30 * energy * gainMul).toFixed(3);
  // ... return "$: ..." string
}

// Inside the track object:
evaluateCode(data) {
  // 1. Extract and quantize data values
  const h = q(data.heat || 0, 0.05);
  // ...

  // 2. Cache check — include gain values in key
  const gainKey = Object.keys(this.voices)
    .map(v => this.getGain(v).toFixed(2)).join(':');
  const key = `${h}:${tone}:${intBand}:${volQ}:${gainKey}`;
  if (_cachedCode && _cachedKey === key) return _cachedCode;

  // 3. Compute derived values
  const energy = 0.4 + h * 0.6;

  // 4. Build code string — layers peel away at low activity
  let code = "setcpm(30);\n";

  // Layers activate at different heat thresholds, gain flows through getGain()
  code += h > 0.2  ? bassLayer(tone, intBand, energy, volQ, this.getGain('bass')) : '$: silence;\n';
  code += h > 0.3  ? drumLayer(intBand, energy, this.getGain('perc')) : '$: silence;\n';
  code += h > 0.1  ? compLayer(intBand, energy, volQ, this.getGain('chords')) : '$: silence;\n';
  code += melodyActive ? melodyLayer(..., this.getGain('melody')) : '$: silence;\n';

  // At heat < 0.1, even the pad fades — approach true silence
  if (h < 0.1) code = "setcpm(30);\n" + '$: silence;\n'.repeat(blockCount);

  // 5. Cache and return
  _cachedCode = code;
  _cachedKey = key;
  return code;
}
```

### 6. Use `.orbit()` for Bus Isolation
Assign each layer family a separate orbit to prevent effect bleed:
- `orbit(1)` — harmonic instruments (piano, pads)
- `orbit(2)` — melody
- `orbit(3)` — bass
- `orbit(4)` — drums/percussion
- `orbit(5)` — event one-shots

---

## Available Sounds

### Sampled Instruments
| Sound | Usage | Notes |
|-------|-------|-------|
| `"piano"` | `.s("piano")` | Salamander Grand Piano, multi-velocity |
| `"gm_acoustic_bass"` | `.s("gm_acoustic_bass")` | GM upright bass |
| `"gm_epiano1"` | `.s("gm_epiano1")` | Rhodes electric piano |
| `"gm_vibraphone"` | `.s("gm_vibraphone")` | Vibraphone |
| `"gm_tenor_sax"` | `.s("gm_tenor_sax")` | Tenor saxophone |
| `"gm_*"` | `.s("gm_...")` | All 128 GM instruments (loaded on demand) |

### Drums (uzu-drumkit + Dirt-Samples)
`bd` `sd` `hh` `oh` `cr` `rd` `rim` `cp` `cb` `ht` `mt` `lt`
Dirt-Samples variants: `bd:0`–`bd:23`, `sd:0`–`sd:11`, `cr:0`–`cr:5`, etc.

### Oscillators
`sine` `sawtooth` `triangle` `square` `pink` (noise)

---

## Strudel Quick Reference

### Mini-Notation Cheatsheet
```
"a b c"       Sequence (evenly spaced in cycle)
"<a b c>"     One per cycle (slow alternation)
"[a b]"       Subdivision (fit in parent slot)
"a,b,c"       Parallel / chord (simultaneous)
"a*4"         Repeat 4× (speeds up)
"a/2"         Spread over 2 cycles (slows down)
"a(3,8)"      Euclidean rhythm (3 pulses in 8 steps)
"~"           Rest / silence
"a?"          50% probability
"a?0.2"       20% probability
"a|b"         Random choice per cycle
"a!4"         Replicate 4× (same speed, not faster)
"a@3"         Elongate (3× relative duration)
"a:2"         Sample variant 2
```

### Common Patterns
```javascript
note("c3 e3 g3").s("piano")             // Melody
s("bd sd bd sd")                         // Drums
stack(drums, bass, melody).cpm(30)       // Layer (pattern mode)
note("<c3 f3 g3 c3>").s("sine")         // Progression (1 per cycle)
s("hh").struct("x ~ x ~ x ~ x ~")      // Rhythmic structure
note("c3").euclid(3,8).s("triangle")    // Euclidean rhythm
```

### Effects (most common)
```javascript
.lpf(hz)            // Low-pass filter (20–20000)
.hpf(hz)            // High-pass filter
.lpq(q)             // Resonance (0–50)
.room(wet)          // Reverb (0–1)
.rsize(size)        // Room size (0–10)
.delay(wet)         // Delay (0–1)
.delaytime(s)       // Delay time
.delayfeedback(fb)  // Feedback (<1!)
.gain(g)            // Volume
.pan(p)             // Stereo (0=L, 0.5=C, 1=R)
.distort(d)         // Distortion
.crush(bits)        // Bit crush
.orbit(n)           // Effect bus
.attack(s)          // Envelope attack
.decay(s)           // Envelope decay
.sustain(lvl)       // Sustain level (0–1)
.release(s)         // Release time
.clip(n)            // Duration multiplier
.speed(r)           // Playback rate
```

### Signals (continuous LFOs / noise)
```javascript
sine, saw, tri, square         // 0 to 1
sine2, saw2, tri2, square2     // -1 to 1
rand, rand2, perlin, irand(n)  // Random
signal.range(lo, hi)           // Map to range
signal.rangex(lo, hi)          // Exponential range
signal.slow(n)                 // Slow down
signal.segment(n)              // Discretize to steps
```

### Tonal (chords, scales, voicings)
```javascript
.scale("C:minor")                        // Apply scale to numbers
.transpose(n)                            // Transpose by semitones
.scaleTranspose(n)                       // Transpose by scale steps
chord("Cm7 F7 Bb^7").voicing()          // Auto-voice chords
chord(changes).dict("ireal").voicing()   // With chord dictionary
note("<0 2 4 6>").scale("C:minor")       // Scale degrees → notes
```

### Pattern Transforms
```javascript
.fast(n) / .slow(n)        // Speed control
.rev()                      // Reverse
.every(n, fn)               // Apply every n cycles
.sometimes(fn)              // 50% chance per event
.often(fn) / .rarely(fn)   // 75% / 25%
.degradeBy(p)               // Random dropout
.superimpose(fn)            // Layer transformed copy on original
.off(t, fn)                 // Time-offset + transform
.jux(fn)                    // Apply to right channel only
.struct("x ~ x ~")         // Impose rhythmic structure
.iter(n)                    // Rotate pattern each cycle
.palindrome()               // Forward then backward
```

---

## Example Tracks

### Track Template

See [examples/_template.js](examples/_template.js) — the annotated template for creating new tracks. Copy this file as your starting point. It documents:
- Full header comment format with data signal reference
- `q()` quantize helper
- Voice code generator pattern (one function per voice with `gainMul` parameter)
- `voices` declaration for mastering page sliders
- `gains` / `getGain()` mastering support
- Cache key construction including gain values
- `onEvent()` handler structure

### Poolside House

See [examples/poolside_house.js](examples/poolside_house.js) — a relaxed daytime house track at 116 BPM with full mastering support.

**What it demonstrates:**
- **Mastering support**: 7 voice declarations (kick, chords, bass, perc, melody, counter, pad), all gains flow through `getGain()`, gain values included in cache key
- **Extracted voice functions**: `kickCode()`, `chordsCode()`, `bassCode()`, `percCode()`, `melodyCode()`, `counterCode()`, `padCode()` — each receives a `gainMul` from `getGain()`
- **Directional contour** (Design Principles §3): melody phrases ascend/descend with momentum, bass walks up/down, chord root motion and pad voicings follow market direction. Sideways market gets meandering patterns with random choices.
- **Generative melody** (Design Principles §2): `.iter(4)`, `.palindrome()`, `.degradeBy()` driven by volatility, `|` random choice in note patterns, `.rarely(add(note(7)))` for octave sparkle
- **Living percussion** (Design Principles §4): perlin-humanized hi-hat velocity, `.sometimes()` accents, `.rarely(ply(2))` flams, `.iter()` rotating emphasis, `.every(4, struct("x(5,8)"))` euclidean variation
- **Layer stripping** (Design Principles §1): pad (>0.1) → rhodes (>0.15) → bass (>0.25) → drums (>0.3) → melody (momentum-driven) → counter-melody (>0.6). At heat=0, all blocks emit silence.
- Rhodes with offbeat stabs, jazz voicings, 3-tier percussion, bouncy walking bass

**Known areas for improvement:**
- Could benefit from a texture/atmosphere layer (filtered noise, nature-like ambience) at mid-heat
- Counter-melody could use a different timbre (vibraphone?) to differentiate from main melody

Study this track for structure and architecture. It implements all four Design Principles and the mastering format.
