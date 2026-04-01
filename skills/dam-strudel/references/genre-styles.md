# Genre and Style Reference

This reference provides genre-specific techniques and data-mapping strategies. Each genre includes sonic characteristics, Strudel implementation patterns, and suggestions for connecting market data signals to musical parameters.

## How to Use This Reference

1. Identify the user's genre/artist request
2. Read the sonic characteristics and Strudel techniques
3. Use the data mapping suggestions to connect market signals to musical parameters
4. Adapt examples — treat them as starting points, not templates
5. Combine elements from multiple genres when appropriate

---

## House

### Deep House

**Sonic Characteristics:**
- Warm, groovy basslines
- Soulful vocal samples
- Jazzy chords (7ths, 9ths)
- Subtle percussion layers
- 4/4 kick with open hi-hat on offbeats
- 120–125 BPM (cpm: 30–31)

**Strudel Techniques:**
```javascript
// Deep house bass
note("c2 ~ eb2 ~ f2 ~ eb2 ~").s("sawtooth").lpf(800).resonance(5).decay(.4)

// Jazzy chords with voicing
chord("<Cm9 Fm7 Bb7 Eb^7>").dict("ireal").voicing().s("piano")
  .struct("~ [~@2 x] ~ [~@2 x]").room(0.3)

// Classic 4/4 with offbeat hats
stack(
  s("bd bd bd bd"),
  s("~ hh ~ hh"),
  s("~ oh ~ ~").gain(0.3)
)
```

**Data Mapping:**
- `tone` → major/minor chord quality (soulful major vs deep minor)
- `heat` → number of percussion layers, overall gain
- `trade_rate` → hi-hat density (quarter notes → 16ths)
- `volatility` → filter cutoff modulation depth on bass
- `momentum` → whether chord progression advances or holds

### Acid House

**Sonic Characteristics:**
- TB-303 style bassline with resonant filter sweeps
- Squelchy, hypnotic, repetitive
- 120–130 BPM (cpm: 30–32)

**Strudel Techniques:**
```javascript
// 303 bassline with filter sweep
note("<c2 eb2 f2 g2>")
  .s("sawtooth")
  .lpf(sine.range(200, 2500).fast(4))
  .lpq(15)
  .lpenv(4).lpd(.2).lpa(.02)
  .ftype('24db')
  .decay(.1)

// Acid with octave jumps
note("[<g1 f1>/8](<3 5>,8)")
  .s("sawtooth")
  .lpf(sine.range(400, 800).slow(16))
  .lpq(cosine.range(6, 14).slow(3))
  .ftype('24db')
  .rarely(x => x.add(note(12)))
```

**Data Mapping:**
- `velocity` → filter sweep speed (`.lpf(sine.range(...).fast(speed))`)
- `volatility` → resonance amount (calm = subtle, volatile = squelchy)
- `price` → filter range (low price = dark/closed, high = bright/open)
- `heat` → pattern density (Euclidean pulse count)

---

## Techno

### General Techno

**Sonic Characteristics:**
- 4/4 kick pattern, 125–140 BPM (cpm: 31–35)
- Euclidean hi-hat patterns
- Repetitive, hypnotic
- Filter sweeps on synth lines
- Heavy delay and reverb

**Strudel Techniques:**
```javascript
// Techno kick
s("bd(4,4)").gain(.9).lpf(120)

// Euclidean hats
s("hh").struct("x(5,8)").gain(.4).hpf(8000)

// Synth line with filter sweep
note("<c2 eb2 f2 g2>").s("sawtooth")
  .lpf(sine.range(300, 2000).fast(4))
  .lpq(10)
```

**Data Mapping:**
- `heat` → kick presence (gain scaling, or 4-on-floor vs Euclidean at low heat)
- `trade_rate` → hi-hat Euclidean density (`s("hh(${pulses},16)")` where pulses scales with trade_rate)
- `volatility` → filter modulation depth and speed
- `momentum` → whether synth line ascends or descends
- `price_move` → filter sweep triggers (sudden opens)

### Dub Techno

**Sonic Characteristics:**
- Deep, rolling bass
- Chord stabs with long delay tails
- Minimalist drums
- Heavy reverb, spacious
- 120–125 BPM (cpm: 30–31)

**Strudel Techniques:**
```javascript
// Dub chord stabs
note("<d3 f3 a3>").slow(4)
  .s("sawtooth").decay(.3)
  .delay(.75).delaytime(.25).delayfeedback(.6)
  .room(.8).lpf(1500)

// Minimal rolling kick
s("bd bd bd bd").gain(0.5).lpf(100)
```

**Data Mapping:**
- `volatility` → delay feedback amount (uncertain = more wash/echo)
- `spread` → reverb size (wide spread = larger room)
- `heat` → layer count (minimal at low, add stabs/textures at high)
- `price` → chord register (low price = low register, high = higher)

---

## Drum & Bass / Jungle

### Jungle

**Sonic Characteristics:**
- Fast: 160–180 BPM (cpm: 40–45)
- Amen break manipulation
- Deep sub bass (sine, 40–80 Hz)
- Reggae/dub influences
- Sample chops and edits

**Strudel Techniques:**
```javascript
// Amen break slicing
samples('github:tidalcycles/dirt-samples')
s("breaks165")
  .slice(8, "0 1 <2 2*2> 3 [4 0] 5 6 7".every(3, rev))
  .sometimes(x => x.speed("<1 0.5 2>"))

// Jungle sub bass
note("d1 ~ ~ d1 ~ d1 ~ ~").s("sine").lpf(80).decay(.6)
```

**Data Mapping:**
- `velocity` → break slice rearrangement complexity
- `price_move` → break chop triggers (sudden rearrangement on movement)
- `heat` → sub bass presence and gain
- `trade_rate` → how chopped-up the break is (simple loop vs complex rearrangement)

### Liquid DnB

**Sonic Characteristics:**
- Melodic, smooth
- Jazz-influenced harmony
- Warm bass tones
- Soulful pads
- 170–176 BPM (cpm: 42–44)

**Strudel Techniques:**
```javascript
// Liquid pad
note("<d3 f3 a3 c4>").add(note("[0,4,7]"))
  .s("triangle").attack(1).release(2).room(.7).lpf(3000)

// Smooth bass
note("<d2 f2 a2 c3>").s("sine").lpf(300).decay(.4).room(.2)
```

**Data Mapping:**
- `tone` → major/minor chord quality
- `momentum` → melodic direction (ascending phrases on uptrend)
- `volatility` → pad detuning and reverb depth
- `heat` → overall gain and layer count

---

## Trap / Hip-Hop

### Trap

**Sonic Characteristics:**
- Hi-hat rolls (fast subdivisions)
- 808 sub bass
- Snare rolls and triplets
- 130–170 BPM half-time feel (cpm: 16–21 for half-time)
- Layered percussion

**Strudel Techniques:**
```javascript
// Trap hi-hat rolls
s("hh*8").sometimes(x => x.fast(2))
  .gain(perlin.range(.3, .6))

// 808 bass
note("c1 ~ eb1 f1").s("sine").lpf(200).distort(2).decay(.8)

// Trap snare with rolls
s("~ sd ~ sd").sometimes(x => x.ply(3))
```

**Data Mapping:**
- `velocity` → hi-hat roll speed (8ths vs 16ths vs 32nds)
- `price_move` → 808 slide triggers
- `heat` → percussion layer count
- `volatility` → hi-hat probability/dropout (`degradeBy` scaled by volatility)
- `trade_rate` → snare roll frequency

### Boom Bap

**Sonic Characteristics:**
- Hard-hitting snare on 2 and 4
- Swing feel
- Soul/jazz sample influence
- 85–95 BPM (cpm: 21–24)

**Strudel Techniques:**
```javascript
// Boom bap drums with swing
stack(
  s("bd").struct("x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~"),
  s("sd").struct("~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~").gain(.7),
  s("hh*16").gain(perlin.range(.2, .4))
).swingBy(0.4, 8)
```

**Data Mapping:**
- `heat` → overall gain, vinyl texture layer presence
- `momentum` → swing amount (more swing on uptrend = more groove)
- `trade_rate` → hi-hat ghost note density
- `tone` → sample selection (bright/warm)

---

## Ambient / Experimental

### Dark Ambient

**Sonic Characteristics:**
- Long, evolving textures
- Low-frequency drones
- Sparse or absent rhythm
- Heavy reverb and space
- Dissonant or atonal harmony

**Strudel Techniques:**
```javascript
// Dark drone
note("d1 f1 ab1").s("sine")
  .attack(4).release(8)
  .room(.95).rsize(8)
  .distort(0.5)
  .lpf(sine.range(200, 800).slow(32))

// Textural noise
s("pink").lpf(perlin.range(400, 1200)).hpf(300).gain(.15).room(.9)
```

**Data Mapping:**
- `price` → drone pitch (low price = very low, uncertain frequencies)
- `volatility` → noise texture level and filter movement
- `spread` → dissonance level (wide spread = more dissonant intervals)
- `heat` → texture density (silent to layered drones)
- `momentum` → slow pitch drift direction

### IDM / Glitch

**Sonic Characteristics:**
- Complex rhythms (Euclidean, polyrhythms)
- Digital artifacts (`.degradeBy()`, `.crush()`)
- Unconventional time signatures
- Frequent pattern variation

**Strudel Techniques:**
```javascript
// Glitchy pattern
s("bd hh sd").struct("x(5,13)")
  .degradeBy(perlin.range(0, .5))
  .crush(4)
  .sometimes(x => x.ply(2))
  .every(4, rev)

// Polyrhythmic layers
stack(
  s("bd(3,8)"),
  s("sd(5,13)"),
  s("hh(7,16)")
)
```

**Data Mapping:**
- `volatility` → bit crush depth, degradation amount
- `trade_rate` → Euclidean pulse counts (more trades = denser rhythms)
- `velocity` → pattern transformation frequency (`.every(n, ...)` where n decreases with velocity)
- `price_move` → trigger pattern reversal or rotation
- `spread` → polyrhythmic complexity (wider spread = more divergent meters)

---

## Jazz

### Jazz Trio

**Sonic Characteristics:**
- Piano, upright bass, drums (ride + brushes)
- Chord changes (ii-V-I, turnarounds)
- Walking bass lines
- Swing feel, ghost notes
- 100–160 BPM (cpm: 25–40)

**Strudel Techniques:**
```javascript
// Jazz changes with voicing
let changes = "<Cm7 F7 Bb^7 Eb^7>";
chord(changes).dict("ireal").voicing()
  .struct("~ [~@2 x] ~ [~@2 x]")
  .s("piano").room(0.25)

// Walking bass (pre-composed, one per bar via <>)
note(`<
  [C2 D2 Eb2 E2]
  [F2 A2 Bb2 A2]
  [Bb2 C3 D3 D2]
  [Eb2 F2 G2 Bb2]
>`).s("gm_acoustic_bass").clip(1)

// Ride pattern
s("rd [rd@2 rd] rd [rd@2 rd]").gain(0.25)
```

**Data Mapping:**
- `tone` → major/minor paradigm (bright changes vs dark changes)
- `trade_rate + velocity` → intensity band (sparse quarter-note walks → busy eighth-note runs)
- `momentum` → melody activation (sustain melody during trends, even after edge-detected price_move decays)
- `volatility` → piano detuning (`.speed(rand.range(...))`), delay feedback, bass LPF (muddier when uncertain)
- `heat` → overall energy/volume scaling
- `price_move` → melodic phrase trigger (ascending on positive, descending on negative)

### Jazz Ballad

**Sonic Characteristics:**
- Slow tempo, rubato feel
- Extended chord voicings
- Sparse bass, brushes
- 60–80 BPM (cpm: 15–20)

**Strudel Techniques:**
```javascript
// Ballad voicings
chord("<Dm9 G13 C^9 Fm9>").dict("ireal").voicing()
  .s("piano").attack(0.1).release(2).room(0.5).gain(0.3)

// Sparse bass
note("<D2 ~ G2 ~ C2 ~ F2 ~>").s("gm_acoustic_bass").clip(2)
```

---

## Dark Ambient Hip-Hop

### Lorn

**Sonic Characteristics:**
- Heavily pitched-down vocal samples (`.speed(0.5–0.7)`)
- Deep melodic sub bass (sine with light saturation, `.lpf(180–250)`)
- Glitchy, industrial textures
- Heavy reverb and delay (`.room(.6–.9)`, `.delay(.25–.5)`)
- Slow: 65–80 BPM (cpm: 16–20)
- Sparse, weighted drums with long decay

**Strudel Techniques:**
```javascript
// Lorn-style bass
note("d1 f1 g1 d1").s("sine")
  .lpf(200).distort(0.4).decay(.7).room(.2)

// Glitchy textures
s("metal").n("<2 4 7 3>").fit()
  .hpf(8000).distort(2).delay(.5).room(.6)
```

**Data Mapping:**
- `price` → bass register (very low price = very deep sub)
- `volatility` → glitch texture volume and activity
- `heat` → drum sparseness (low heat = very sparse, almost silent)
- `momentum` → bass note movement direction
- `spread` → reverb depth (wider spread = more cavernous)

### Clams Casino

**Sonic Characteristics:**
- Ethereal, pitched vocal chops (`.speed(0.5–0.8)`, heavy reverb)
- Lush pads with stereo width
- Dreamy atmosphere (long reverb `.room(.8–.9)`)
- Simple, sparse drums
- Extended chords (7ths, 9ths, 11ths)
- Delay as melodic element

**Strudel Techniques:**
```javascript
// Atmospheric pads
note("<d2 f2 g2 a2>").add(note("[0,7,10,14]"))  // Extended voicings
  .s("triangle").attack(1.5).release(3)
  .room(.9).pan(sine.range(0.3, 0.7).slow(16))

// Dreamy texture
note("<c4 eb4 g4>").s("sine")
  .delay(.375).delayfeedback(.6)
  .room(.8).rsize(6)
```

**Data Mapping:**
- `volatility` → reverb size and delay feedback (uncertainty = dreamier)
- `price` → pad register and chord extension complexity
- `heat` → drum presence (silent at 0, minimal at 1)
- `tone` → bright/dark pad voicings
- `momentum` → stereo pan movement speed

---

## Design Principles for Data-Driven Genres

1. **Genre sets the palette; data paints the picture.** Choose sounds, tempo, effects, and harmonic language from the genre. Let data drive intensity, density, tension, and direction.

2. **Pre-compose, don't generate.** Write patterns for each intensity band by hand (like the jazz trio's 3-band bass walks). Data selects which pre-composed pattern plays — it doesn't algorithmically generate notes.

3. **Map data to what the genre values.** House values groove → map `trade_rate` to rhythmic density. Ambient values texture → map `volatility` to reverb and noise. Jazz values harmony → map `tone` to chord changes.

4. **Use `heat` as master volume, not master complexity.** A quiet market should sound like a quiet version of the genre, not a different genre. The genre's character should be recognizable at any energy level.

5. **Reserve `price_move` for moments.** It's a phrase trigger, not a sustained value. Use it for fills, runs, stabs — things that punctuate, not things that sustain.
