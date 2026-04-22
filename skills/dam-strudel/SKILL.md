---
name: strudel
description: Write data-driven music tracks for Data as Music (dam.fm) using Strudel. Use when creating, modifying, or debugging tracks that sonify live prediction market data into music.
argument-hint: genre, mood, or modification request
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Strudel — Data as Music Track Author

## Overview

Strudel is a browser-based live-coding music environment (JavaScript port of TidalCycles). Data as Music (dam.fm) uses Strudel to sonify live prediction market data — turning price movements, trading activity, and market sentiment into music.

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

**Pick the right "is it quiet?" signal.** Prefer `heat` (overall activity) and `price_move` (edge-detected price movement) for silence gates. Both reliably reach zero when the market is idle. Do NOT gate silence on `momentum` — it's a lagged EMA divergence that hovers above zero on any real book (see "Pitfall: `price_move` vs `momentum`" in Data Signals).

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
- `momentum` → melodic contour direction (see Design Principles §3 — Price Direction Must Be Audible)
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

### 4. Every Layer Needs Dynamic Range

This is the most important principle for sounding musical. **Every instrument or group of instruments must have progressive stages of intensity that track the market continuously** — not just binary on/off at a heat threshold.

Gain alone is not enough. A four-on-the-floor kick at gain 0.05 is still a four-on-the-floor kick — it sounds like a full drum pattern turned down, not like a quiet market. True dynamic range means the **pattern itself changes**: fewer notes, simpler rhythms, sparser arrangement at low intensity, building up to full density at high intensity.

**The principle applies to every layer:**

#### Percussion (as a group)

Percussion should be designed as a unified group with stages. Each stage adds instruments and rhythmic complexity. The stages should be tied to the market metrics that represent rhythmic energy (`heat` for overall density, `trade_rate` + `velocity` for complexity).

```javascript
// BAD: Drums are either on or off
code += h > 0.3
  ? `$: s("bd bd bd bd").gain(${g});\n`
  : '$: silence;\n';

// GOOD: Progressive percussion stages
function percCode(h, intBand, energy, gainMul) {
  // Stage 1 (h > 0.15): Just a sparse kick — downbeat only
  // Stage 2 (h > 0.3):  Kick thickens (half-time), hats appear (quarters)
  // Stage 3 (h > 0.45): Full kick (four-on-floor), hats at 8ths, snare enters
  // Stage 4 (h > 0.65): Add fills, 16th hats, open hats, rim patterns
  // Gain ALSO scales with energy within each stage
}
```

Pre-compose the kick pattern for each stage:
```javascript
// Kick stages — pattern density tracks heat
const kickPattern =
  h < 0.30 ? "bd ~ ~ ~"           :  // downbeat only — minimal pulse
  h < 0.45 ? "bd ~ bd ~"          :  // half-time — building
  h < 0.65 ? "bd bd bd bd"        :  // four-on-the-floor — driving
             "bd bd bd bd"         ;  // same pattern, but add fills via .every()

// Hi-hat stages — subdivision tracks intBand/trade_rate
const hhPattern =
  intBand === 0 ? "hh ~ hh ~"     :  // quarter notes
  intBand === 1 ? "hh*8"          :  // 8th notes
                  "hh*16"          ;  // 16th notes with ghost notes
```

#### Melodic instruments (bass, chords, melody)

Same principle — pattern complexity should scale with the market:
```javascript
// Bass: from whole notes → walking quarters → busy eighths
const bassPattern =
  intBand === 0 ? "<C2 A2 D2 G2>"                          :  // one note per bar
  intBand === 1 ? "<[C2 ~ E2 ~] [A2 ~ C3 ~]>"             :  // half-time groove
                  "<[C2 D2 E2 F2] [A2 B2 C3 D3]>"          ;  // walking line

// Chords: from sustained pads → rhythmic stabs → busy comping
const chordStruct =
  intBand === 0 ? "x ~ ~ ~"                                :  // one hit per bar
  intBand === 1 ? "~ [~@2 x] ~ [~@2 x]"                   :  // offbeat stabs
                  "~ [~@2 x] [~ x] [~@2 x]"               ;  // busier comping
```

#### Why this matters for warmup

The server applies a smoothstep warmup tween that brings activity signals (heat, trade_rate, velocity, etc.) from 0 to real values over ~18 seconds. If your patterns respond to these signals with genuine dynamic range — sparse patterns at low values, building to full density at high — then the warmup automatically sounds like a natural intro: the track literally builds up from nothing. If your patterns are binary on/off, the warmup can only turn gain down, which sounds like a muted full arrangement rather than a true build.

**Design every layer so it sounds intentionally musical at every point in the 0→1 range**, not just at the top.

### 5. Percussion Must Have Life

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
- `heat` → number of active percussion layers AND pattern density (see §4)

---

## Data Signals

Every 3 seconds, `evaluateCode(data)` receives:

### Continuous Signals

| Signal | Range | Musical Role | Mapping Ideas |
|--------|-------|-------------|---------------|
| `heat` | 0–1 | **Energy** | Volume, layer count, rhythmic density, arrangement fullness |
| `price` | 0–1 | **Harmonic position** | Register, note choice. 0.5 = max tension. 0.9+ = resolution. <0.2 = doom |
| `price_move` | -1–1 | **Phrase trigger / "is price moving NOW?"** | Melodic runs, arpeggios, fills, alert gates. Edge-detected: fires on active 30s movement or drift (1.5¢+), and is **exactly zero when the price is flat**. Momentary gestures. |
| `momentum` | -1–1 | **Section mood / sustained trend direction** | Build energy on uptrend, pull back on downtrend. Dual-EMA (MACD-style) divergence — lags price, decays slowly after a move, and **hovers above zero whenever the fast/slow EMAs aren't perfectly aligned** (i.e. almost always on a jittery book). Do NOT use as a "silent when flat" gate — use `price_move` for that. |
| `velocity` | 0–1 | **Pace** | Subdivision, tempo feel, rhythmic urgency. 5-min window, absolute: 10¢ move = 1.0 |
| `volatility` | 0–1 | **Tension/uncertainty** | Dissonance, detuning, filter wobble, tremolo, irregular rhythms |
| `trade_rate` | 0–1 | **Complexity** | Drum density, voice count, melodic ornamentation |
| `spread` | 0–1 | **Liquidity feel** | Wide intervals vs tight clusters, consonance vs dissonance |
| `tone` | 0 or 1 | **Key/mode** | 1 = bullish/major. 0 = bearish/minor. Has hysteresis — won't flicker. |

### Pitfall: `price_move` vs `momentum` — choosing the right gate

These both carry signed direction and can tempt you to use either, but they mean different things:

- **`price_move` is "is price moving RIGHT NOW?"** — edge-detected and *truly zero* when the price is flat. Use it for:
  - Alert tracks that should fall silent between moves
  - Phrase triggers (runs, fills, one-shots)
  - Any "show me direction only when direction exists" gate
- **`momentum` is "what's the sustained trend direction?"** — a dual-EMA divergence. The fast and slow EMAs only converge after several time-constants of perfect stability, so on a real order book (with constant bid/ask jitter) `momentum` almost never hits zero — it hovers at small non-zero values indefinitely. Plus the normalization is `raw / 0.05`, so a 0.25¢ EMA gap already reads as 0.05. Use it for:
  - Sustained mood: energy ramps, register shifts, arrangement density during trends
  - Melodic contour direction in music tracks (skill §3)
  - Anything that should stay "on" through a trend even while the price ticks are small

**If you gate silence on `|momentum| < threshold`, the track will play almost constantly.** This was the bug in Weather Vane v1 — the fix was to gate on `price_move` instead. Sensitivity still applies to `price_move` server-side (power curve after edge detection), so using `price_move` does not cost you sensitivity-slider integration.

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
| `whale` | `direction: 1\|-1`, `magnitude: 0–1`, `size: float` | Large trade (≥3x rolling median). Magnitude: 3x=0.33, 6x=0.67, 9x+=1.0. `size` is raw USDC amount. |

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
| Kick | `heat > 0.15` | `heat` (pattern density: sparse → half-time → four-on-floor), `heat` (gain) | Very low activity |
| Percussion | `heat > 0.25` | `heat` (which instruments active), `trade_rate` + `velocity` (intBand → subdivision/complexity) | Low activity — kick may pulse alone |
| Bass | `heat > 0.2` | `tone` (key), `heat` (gain), `intBand` (pattern density: whole notes → walking), `volatility` (LPF), **`momentum` (walking direction)** | Low activity — pad carries alone |
| Chords/Comp | `heat > 0.15` | `tone` (chord quality), `heat` (gain), `intBand` (sustained → rhythmic stabs), `volatility` (detuning), **`momentum` (root motion direction)** | Last to go, first to return |
| Melody | `\|momentum\| > 0.2` or `heat > 0.5` | **`momentum` (contour direction)**, `tone` (scale), `intBand` (density), `volatility` (fragmentation) | Must use generative techniques (see Design Principles §2) |
| Pad | `heat > 0.1` | `tone`, `heat` (gain), `volatility` (reverb/detuning), **`momentum` (voicing direction)** | Last layer standing |
| Texture | `volatility > 0.3` | `volatility` (gain), `spread` (filter) | Calm markets |
| Events | On trigger | `spike` (magnitude), `price_move` (direction + magnitude), `whale` (large trade) | Always conditional |

**The goal**: at minimum data values, only the faintest pad (or nothing) is audible. At maximum, every layer is active and rich.

### 4. Design Intensity Bands
Quantize activity into 2–3 bands using `trade_rate` and `velocity`:

```javascript
const rawIntensity = 0.6 * tradeRate + 0.4 * velocity;
const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
```

Pre-compose **complete patterns for each band** — don't just scale gain. Each band should sound like a deliberate arrangement choice:

- **Band 0 (low)**: Quarter-note hats, sparse kick (downbeat or half-time), no snare, whole-note bass, sustained chords
- **Band 1 (mid)**: 8th-note hats, full kick, snare enters, walking bass, offbeat chord stabs
- **Band 2 (high)**: 16th-note hats with ghost notes, fills, rim patterns, busy bass runs, active comping

**Combine intBand with heat for two-axis control:** `intBand` controls pattern complexity/density, `heat` controls which layers are active and their gain. This gives a wide dynamic range — from a single sparse kick at low heat/low intBand, to a full kit with fills at high heat/high intBand.

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
| `"gm_vibraphone"` | `.s("gm_vibraphone").n(4)` | Vibraphone (use `.n(4)` for GeneralUserGS — see warning below) |
| `"gm_tenor_sax"` | `.s("gm_tenor_sax")` | Tenor saxophone |
| `"gm_*"` | `.s("gm_...")` | All 128 GM instruments (loaded on demand) |

> **GM Soundfont data quality warning**: The WebAudioFont data (from `surikov/webaudiofontdata`) has corrupt/tiny zones in some soundfont variants — notably the default vibraphone (`n=0`, JCLive) has a broken zone for MIDI 84-108 (C6+) with only ~225 bytes of sample data, causing `decodeAudioData` failures. The bundle includes logging and silent-buffer fallback for these cases. When using GM instruments in high registers, prefer the **GeneralUserGS** variant (`.n(4)`) which has valid data across all zones. Other instruments may have similar issues with specific variants — check the console for `[Soundfont]` warnings.

### Drums (uzu-drumkit + Dirt-Samples)
`bd` `sd` `hh` `oh` `cr` `rd` `rim` `cp` `cb` `ht` `mt` `lt`
Dirt-Samples variants: `bd:0`–`bd:23`, `sd:0`–`sd:11`, `cr:0`–`cr:5`, etc.

### Oscillators
`sine` `sawtooth` `triangle` `square` `pink` (noise)

---

## Custom Samples (Local Audio Files)

For tracks that need project-specific sounds — voice clips, meme samples, field recordings, one-shot SFX — drop audio files into the repo's `samples/` directory and register them as Strudel aliases in the audio engine's prebake.

### 1. Drop the files

```
samples/
  so_over.mp3
  so_back.mp3
```

Keep each file small (< 200 KB ideally) and pre-mastered. MP3/WAV/OGG all work. Files are committed to git, so they ship with the deploy.

### 2. The server route

`server.py` serves `samples/` at the URL path `/samples/` via aiohttp's `add_static`. This is already wired up — no changes needed when adding new files:

```python
samples_path = Path("samples")
if samples_path.exists():
    app.router.add_static("/samples/", path=str(samples_path), name="samples")
```

After dropping a file, it is reachable at e.g. `http://localhost:8888/samples/so_over.mp3`.

### 3. Register the alias in Strudel's prebake

In `frontend/audio-engine.js`, inside the `prebake` block, add your alias to the `samples({...})` dict call. Strudel's `samples()` accepts a map of `{ alias: 'url' }` and registers each alias for use as `.s("alias")`:

```javascript
samples({
  so_over: '/samples/so_over.mp3',
  so_back: '/samples/so_back.mp3',
  // Add new aliases here:
  // my_clip: '/samples/my_clip.wav',
}),
```

Then add the new alias to the warmup stack a few lines down so the browser fetches and decodes the sample before playback starts — otherwise the first trigger will be silent for 1–3s while the file loads:

```javascript
sound("so_over so_back my_clip"),  // add aliases here
```

### 4. Use the sample in a track

Once registered, a sample alias behaves exactly like `bd` or `piano` — reference it via `.s("alias")` or `s("alias")`:

```javascript
// Simple one-shot on a beat
$: s("so_back").gain(0.8).orbit(2);

// Alternate between two samples depending on direction
const alias = pm > 0 ? "so_back" : "so_over";
$: s("${alias}").gain(${g}).room(0.1).orbit(2);

// Sparse firing via <> alternation (same trick as melodic phrases)
$: s("<so_back ~ ~>").gain(0.7).orbit(2);  // fires every 3 cycles

// Sample choice chosen probabilistically each cycle
$: s("[so_back|so_over]").gain(0.6).orbit(2);

// Chop a longer sample — .begin/.end select a slice (0-1 of the file)
$: s("my_clip").begin(0.25).end(0.5).gain(0.7).orbit(2);

// Re-pitch by playback rate (also time-stretches)
$: s("my_clip").speed(1.5).gain(0.6).orbit(2);
```

### Sample-specific gotchas

- **Samples are not pitched.** `.note(...)` on a custom sample just re-pitches it via playback rate, which time-stretches. If you need pitched instruments, use `gm_*` soundfonts or `piano` instead.
- **Long samples overlap with retriggers.** A 2-second sample at `cpm=60` (1 cycle/s) will be cut off or overlap. Match your `cpm` and pattern density to the sample length, or use `<>` / sparse patterns to avoid retriggers. `.clip(n)` trims playback.
- **Keep filenames lowercase with underscores.** The alias you pass to `samples({...})` becomes the sound name in track code; `so_back` is easier to type than `So Back.mp3`.
- **Aliases live in audio-engine prebake, not in track files.** Never call `samples()` from a track — it races with playback and can register twice. The prebake runs once, up front.
- **Don't hash-bust sample URLs.** The `/static/` route gets cache-busting query strings; `/samples/` does not. If a sample changes, bump the alias name (`so_back` → `so_back_v2`) or ask the user to hard-refresh.

### Category note

A track can declare any category string in its header comment (`// category: 'funny'`). For the category tab to appear in the UI, add it to the order list in `frontend/app.js`:

```javascript
const order = [['music', 'Music'], ['alert', 'Alerts'], ['funny', 'Funny'], ['diagnostic', 'Diagnostic']];
```

Existing categories: `music`, `alert`, `funny`, `diagnostic`.

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

### Digging in the Markets

See [examples/digging_in_the_markets.js](examples/digging_in_the_markets.js) — a dusty lo-fi hip hop track at 80 BPM (cpm=20) with full mastering support. This is a production track shipping on dam.fm; it's the most fleshed-out demonstration of the design principles in the codebase.

**What it demonstrates:**
- **Mastering support**: 8 voice declarations (kick, snare, hihat, keys, bass, melody, texture, pad), all gains flow through `getGain()`, gain values included in cache key
- **Extracted voice functions**: `kickCode()`, `snareCode()`, `hihatCode()`, `keysCode()`, `bassCode()`, `melodyCode()`, `textureCode()`, `padCode()` — each receives a `gainMul` from `getGain()`
- **Motif-based melody system** (Design Principles §2): a seed motif `[0,1,2,4]` (pentatonic degrees) drives nine 8-bar phrase sets — 3 magnitude levels × 3 directions (rise/fall/flat). Bars 1 & 8 anchor the motif, bars 2–7 develop it via neighbour, sequence, extension, truncation, enclosure, and retrograde answer. Volatility adds `.degradeBy()` fragmentation; high `intBand` adds `.rarely(add(note(5)))` octave reinforcement.
- **Directional contour** (Design Principles §3): melody phrases literally climb on uptrend (`RISE_LOW/MED/HIGH`) and descend on downtrend (`FALL_LOW/MED/HIGH`); flat markets get oscillating motif fragments that never reach degree 4 — the resolution the ear is waiting for. Bass roots walk up/down chord tones. Rhodes chord progressions ascend or descend. Pad triads follow the same motion.
- **Progressive kick stages** (Design Principles §4): kick pattern changes by heat band — `"bd ~ ~ ~"` (beat 1 only) below h=0.40, `"bd ~ ~ ~ bd ~ ~ ~"` (beats 1 & 3) below h=0.60, then `"bd ~ ~ [~ bd] bd ~ ~ ~"` with a ghost pickup above. Snare ramps from `"~ rim ~ ~"` → rim backbeat → full snare by `intBand`. Hats go 4 → 8 → 16 subdivision with `.degradeBy()` on the top tier.
- **Living percussion** (Design Principles §5): perlin-humanized hat velocity (`gain(perlin.range(lo, hi))`), `.iter(4)` rotating emphasis on 8th-note hats, `.sometimes()` accents and `.swingBy(0.18, 4)` for the lo-fi groove, 8th-note delay on the piano melody with `.delayfeedback(0.4)`
- **Layer stripping** (Design Principles §1): texture (>0.05) → pad (>0.10) → bass (>0.20) → rhodes (>0.25) → kick + hats (>0.25) → snare (>0.30) → melody (`|mom| > 0.2` or `h > 0.45`). At `heat=0`, every block emits `$: silence;`.
- **Event ornamentation**: `spike` → soft open hat, `price_move` → the seed motif `[0,1,2,4]` or its inversion fires as a piano run, `resolved` → a sustained Rhodes chord as a finale
- **Fixed key, directional mood**: always Bb pentatonic — mood comes from melodic direction, not mode. `tone` still swaps chord quality between Bb major (`<Bb^7 Cm7 Dm7 Eb^7>`) and G minor (`<Gm7 Bb^7 Cm7 Dm7>`), but the scale stays put so phrases from adjacent states don't clash.

Study this track for structure and architecture. It implements all five Design Principles and the mastering format, and the motif system is a useful pattern to crib when writing any melody that needs to sustain a long listening session without feeling looped.
