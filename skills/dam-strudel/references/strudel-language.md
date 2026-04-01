# Strudel Language Reference

Strudel ports TidalCycles' functional pattern language to JavaScript. Patterns are immutable query functions that transform time spans into event streams. Every transformation returns a new pattern — no mutation.

## Core Concepts

- **Cycles**: The fundamental time unit. Default = 0.5 CPS (2 seconds). All patterns align to cycle boundaries.
- **Method chaining**: Fluent interface — `.fast(2).rev().add(7)`
- **Mini-notation**: Double-quoted strings are parsed as pattern DSL — `"bd hh sd hh"`
- **Immutability**: Transformations create new patterns wrapping old ones.

## Mini-Notation DSL

### Sequence and Structure

```javascript
// Space-separated — events evenly distributed in cycle
note("c e g b")  // 4 events, each 1/4 cycle

// Square brackets — subdivide parent slot
note("e5 [b4 c5] d5 [c5 b4]")
note("e5 [b4 c5] d5 [c5 b4 [d5 e5]]")  // Nest arbitrarily

// Angle brackets — slow cat (one element per cycle)
note("<e5 b4 d5 c5>")      // Cycles through one at a time
note("<e5 b4 d5 c5>*8")    // Can be multiplied

// Comma — parallel/simultaneous
note("[g3,b3,e4]")  // Chord
note("g3,b3,e4")    // Outer brackets optional
```

### Timing Operators

```javascript
"[e5 b4 d5 c5]*2"   // Speed up — play twice per cycle
"hh*8"               // 8 hi-hats per cycle
"[e5 b4 d5 c5]/2"   // Slow down — spread over 2 cycles
"[g3,b3,e4]@2 [a3,c3,e4]"  // @weight — relative duration
"[g3,b3,e4]!2 [a3,c3,e4]"  // !replicate — repeat without speedup
"b4 [~ c5] d5 e5"   // ~ or - = rest/silence
```

### Euclidean Rhythms

```javascript
s("bd(3,8)")        // 3 pulses over 8 steps (Bjorklund)
s("bd(3,8,3)")      // With rotation offset
s("bd(-3,8)")       // Negative pulses = inverted
```

### Polymeter

```javascript
// {} = polymeter — patterns cycle at different rates
sound("{per per:6 [~ per:14] per:27, text:17 ~ ~ ~ tone:29}")
note("{c eb g, c2 g2}%6")  // Align to 6 steps
```

### Randomness

```javascript
sound("bd hh? sd? oh")       // ? = 50% removal
sound("bd hh?0.1 sd?0.9")   // Explicit probability
note("[c3|e3|a3]")           // | = random choice per cycle
```

### Sample Selection

```javascript
sound("casio:1")             // Sample index from bank
n("0 1 [4 2] 3*2").sound("jazz")  // Functional form
```

### Mini-Notation to Function Equivalents

| Mini-Notation | Function | Description |
|---------------|----------|-------------|
| `"x y"` | `seq(x, y)` | Sequence (fastcat) |
| `"<x y>"` | `cat(x, y)` | Slow cat |
| `"x,y"` | `stack(x, y)` | Parallel |
| `"x@3 y@2"` | `stepcat([3,x], [2,y])` | Weighted |
| `"{a b, x y}"` | `polymeter(...)` | Polymeter |
| `"~"` | `silence` | Rest |
| `"x*n"` | `fast(n)` | Speed up |
| `"x/n"` | `slow(n)` | Slow down |

## Pattern Construction

### Basic Constructors

```javascript
cat("e5", "b4", ["d5", "c5"]).note()       // One per cycle: "<e5 b4 [d5 c5]>"
seq("e5", "b4", ["d5", "c5"]).note()       // All in one cycle: "e5 b4 [d5 c5]"
stack("g3", "b3", ["e4", "d4"]).note()     // Simultaneous: "g3,b3,[e4,d4]"
s("hh*4").stack(note("c4(5,8)"))           // Chained stacking
```

### Weighted Concatenation

```javascript
stepcat([3,"e3"], [1, "g3"]).note()  // "e3@3 g3"

arrange(
  [4, "<c a f e>(3,8)"],
  [2, "<g a>(5,8)"]
).note()  // Multi-cycle arrangement
```

### Polymeter

```javascript
polymeter("c eb g", "c2 g2").note()
polymeterSteps(2, ["c", "d", "e", "f"]).note()
```

### Utility Constructors

```javascript
silence          // Empty pattern
run(n)           // 0, 1, 2, ... n-1
binary(n)        // Binary representation as pattern
binaryN(n, len)  // Binary with fixed length
```

## Time and Rhythm Operations

### Speed Control

```javascript
s("bd hh sd hh").fast(2)          // 2× speed
s("bd hh sd hh").slow(2)          // Half speed
note("c d e f").fast("<1 2 4>")   // Patterned speed
note("c e g").hurry(2)            // fast + speed (pitch shift)
```

### Temporal Shifting

```javascript
"bd ~".stack("hh ~".early(.1)).s()   // Nudge earlier
"bd ~".stack("hh ~".late(.1)).s()    // Nudge later
s("hh*8").late("[0 .01]*4")          // Humanization
```

### Temporal Windowing

```javascript
s("bd*2 hh*3 [sd bd]*2 perc").zoom(0.25, 0.75)  // Play portion
s("bd sd").compress(.25, .75)                      // Compress into timespan
s("lt ht mt cp, [hh oh]*2").linger("<1 .5 .25 .125>")
s("bd sd").fastGap(2)                              // Speed up with gap
```

### Reversal and Rotation

```javascript
note("c d e g").rev()                              // Reverse
note("c d e g").palindrome()                       // Alternate fwd/bwd
note("0 1 2 3".scale('A minor')).iter(4)           // Rotate start each cycle
note("0 1 2 3".scale('A minor')).iterBack(4)       // Reverse rotation
```

### Duration Control

```javascript
note("c a f e").s("piano").clip("<.5 1 2>")  // Duration multiplier
s("bd ~ sd cp").ply("<1 2 3>")               // Repeat each event
note(saw.range(40,52).segment(24))           // Discretize continuous
```

### Euclidean Operations

```javascript
note("c3").euclid(3,8)              // 3-in-8 Euclidean
note("c3").euclidRot(3,16,14)       // With rotation
note("c3").euclidLegato(3,8)        // Hold until next pulse
```

### Swing and Groove

```javascript
s("hh*8").swingBy(1/3, 4)   // Delay 2nd half of slices
s("hh*8").swing(4)           // Shorthand (1/3 offset)
```

### Tempo Control

```javascript
setcps(1)        // 1 cycle per second
setcpm(110)      // 110 cycles per minute
s("<bd sd>,hh*2").cpm(90)
// BPM conversion: setcpm(BPM / beats_per_cycle)
// For 4/4 time: setcpm(120 / 4) = setcpm(30) for 120 BPM
```

## Pattern Transformations

### Higher-Order Functions

```javascript
note("c d e f").every(4, x => x.rev())                  // Every 4 cycles
"c3 eb3 g3".when("<0 1>/2", x => x.sub(5)).note()       // Conditional
note("c3 d3 e3 g3").lastOf(4, x => x.rev())             // Last of 4
note("c3 d3 e3 g3").firstOf(4, x => x.rev())            // First of 4
```

### Stochastic Application

```javascript
s("hh*8").sometimes(x => x.speed("0.5"))        // 50%
s("hh*8").sometimesBy(.4, x => x.speed("0.5"))  // 40%
.often(fn)          // 75%
.rarely(fn)         // 25%
.almostNever(fn)    // 5%
.almostAlways(fn)   // 95%

// Cycle-level (not event-level)
s("bd,hh*8").someCyclesBy(.3, x => x.speed("0.5"))
s("bd,hh*8").someCycles(x => x.speed("0.5"))    // 50%
```

### Layering and Accumulation

```javascript
// superimpose — layer transformation on original
"<0 2 4 6>*8".superimpose(x => x.add(2)).scale('C minor').note()

// layer — transformations without original
"<0 2 4 6>*8".layer(x => x.add("0,2")).scale('C minor').note()

// off — offset and layer transformation
"c3 eb3 g3".off(1/8, x => x.add(7)).note()

// echo — repeats with velocity decay
s("bd sd").echo(3, 1/6, .8)

// echoWith — custom function each iteration
"<0 [2 4]>".echoWith(4, 1/8, (p,n) => p.add(n*2)).scale("C:minor").note()

// stut — stutter effect (repeats, time, feedback)
s("bd sd").stut(3, 0.5, 1/8)
```

### Structural Transformations

```javascript
// chunk — divide into n parts, transform per cycle
"0 1 2 3".chunk(4, x => x.add(7)).scale("A:minor").note()
"0 1 2 3".chunkBack(4, x => x.add(7)).scale("A:minor").note()

// inside/outside — transform at different time scales
"0 1 2 3 4 3 2 1".inside(4, rev).scale('C major').note()
"<[0 1] 2 [3 4] 5>".outside(4, rev).scale('C major').note()
```

### Masking and Filtering

```javascript
note("c,eb,g").struct("x ~ x ~ ~ x ~ x ~ ~ ~ x ~ x ~ ~").slow(2)
note("c [eb,g] d [eb,g]").mask("<1 [0 1]>")
s("[<bd lt> sd]*2, hh*8").reset("<x@3 x(5,8)>")
```

### Pattern Selection

```javascript
// pick — select patterns by index or name
note("<0 1 2!2 3>".pick(["g a", "e f", "f g f g", "g c d"]))
s("<a!2 [a,b] b>".pick({a: "bd(3,8)", b: "sd sd"}))

// squeeze — compress selected pattern into event
note(squeeze("<0@2 [1!2] 2>", ["g a", "f g f g", "g a c d"]))

// inhabit — named pattern selection
"<a b [a,b]>".inhabit({a: s("bd(3,8)"), b: s("cp sd")})
```

### Arpeggiation

```javascript
note("<[c,eb,g]!2 [c,f,ab] [d,f,ab]>").arp("0 [0,2] 1 [0,2]")
note("<[c,eb,g]!2 [c,f,ab] [d,f,ab]>").arpWith(haps => haps[2])
```

### Randomness

```javascript
s("hh*8").degradeBy(0.2)            // Remove 20%
s("hh*8").degrade()                  // Remove 50%

choose("sine", "triangle", "bd:6")  // Random per event
wchoose(["sine",10], ["triangle",1]) // Weighted random

chooseCycles("bd", "hh", "sd").s()   // Random per cycle
```

### Value Modifiers

```javascript
n("0 2 4".add("<0 3 4 0>")).scale("C:major")   // Add (transpose)
n("0 2 4".sub("<0 1 2 3>")).scale("C4:minor")  // Subtract
"<1 1.5 2>*4".mul(150).freq()                  // Multiply
sine.range(100, 2000)       // Map 0-1 to range
sine.rangex(100, 2000)      // Exponential curve
```

### Stereo Operations

```javascript
s("lt ht mt ht hh").jux(rev)                           // Transform right channel
s("bd lt [~ ht] mt").juxBy("<0 .5 1>/2", rev)          // Adjustable width
s("[bd hh]*2").pan("<.5 1 .5 0>")                       // Manual pan
```

## Audio Effects and Sound Design

### Filters

```javascript
// Low-pass (aliases: cutoff, ctf, lp)
s("bd sd,hh*8").lpf("<4000 2000 1000 500>")
s("bd*16").lpf("1000:0 1000:10 1000:20 1000:30")  // cutoff:resonance
s("bd sd,hh*8").lpf(2000).lpq("<0 10 20 30>")     // Separate Q

// High-pass (aliases: hp, hcutoff)
s("bd sd,hh*8").hpf("<4000 2000 1000 500>")
s("bd sd,hh*8").hpf(2000).hpq("<0 10 20 30>")

// Band-pass (aliases: bandf, bp)
s("bd sd,hh*6").bpf("<1000 2000 4000 8000>")

// Filter type (12db, ladder, 24db)
note("c f g g a c d4").fast(2).sound('sawtooth')
  .lpf(200).ftype("<ladder 12db 24db>")

// Vowel formant filter
note("[c2 <eb2 <g2 g1>>]*2").s('sawtooth')
  .vowel("<a e i <o u>>")
// Available: a e i o u ae aa oe ue y uh un en an on
```

### Filter Envelopes

```javascript
// Low-pass envelope
.lpa(0.005)    // Attack
.lpd(.02)      // Decay
.lps(.5)       // Sustain (0-1)
.lpr(.1)       // Release
.lpenv(4)      // Envelope depth (can be negative)
.ftype('24db')

// High-pass: hpa, hpd, hps, hpr, hpenv
// Band-pass: bpa, bpd, bps, bpr, bpenv
```

### Amplitude Envelope (ADSR)

```javascript
note("c3 e3 f3 g3")
  .attack("<0 .1 .5>")
  .decay("<.1 .2 .3 .4>")
  .sustain("<0 .1 .4 .6 1>")
  .release("<0 .1 .4 .6 1>/2")

// Combined
note("[c3 bb2 f3 eb3]*2").sound("sawtooth").adsr(".1:.1:.5:.2")
```

### Pitch Envelope

```javascript
n("<-4,0 5 2 1>*<2!3 4>")
  .scale("<C F>/8:pentatonic")
  .s("gm_electric_guitar_jazz")
  .penv("<.5 0 7 -2>*2")  // Modulation in semitones
  .patt(.02)               // Attack
  .pdec(.1)                // Decay
  .prel(.1)                // Release
  .pcurve("<0 1>")         // 0=linear, 1=exponential
```

### Distortion and Waveshaping

```javascript
s("bd sd,hh*8").distort("<0 2 3 10:.5>")     // Distortion (0-10+)
s("<bd sd>,hh*3").fast(2).crush("<16 8 4 2>") // Bit crush (16=clean, 1=harsh)
s("bd sd,hh*8").coarse("<1 4 8 16 32>")      // Sample rate reduction
```

### Delay (Global Effect)

```javascript
s("bd bd").delay("<0 .25 .5 1>")                    // Level 0-1
s("bd bd").delay("0.65:0.25:0.9 0.65:0.125:0.7")   // level:time:feedback
s("bd bd").delay(.25).delaytime(.125).delayfeedback(.5)  // Separate params
// WARNING: delayfeedback >= 1 = infinite feedback
```

### Reverb (Global Effect)

```javascript
s("bd sd [~ bd] sd").room("<0 .2 .4 .6 .8 1>")     // Level 0-1
s("bd sd [~ bd] sd").room(.8).rsize(4).rfade(4).rlp(5000)
// rsize: 0-10, rfade: seconds, rlp: lowpass Hz, rdim: lowpass at -60dB
```

### Phaser

```javascript
n(run(8)).scale("D:pentatonic").s("sawtooth")
  .phaser("<1 2 4 8>")           // Speed
  .phaserdepth("<0 .5 .75 1>")   // Depth 0-1
  .phasercenter(1000)             // Center Hz
  .phasersweep(2000)              // Sweep range
```

### Tremolo

```javascript
note("d d d# d".fast(4)).s("supersaw")
  .tremolosync("4")               // Speed in cycles
  .tremolodepth("<1 2 .7>")       // Depth
  .tremoloskew("<.5 0 1>")        // Shape 0-1
  .tremoloshape("<sine tri square>")
```

### Dynamics

```javascript
s("hh*8").gain(".4!2 1 .4!2 1 .4 1")          // Volume
s("hh*8").gain(".4!2 1").velocity(".4 1")       // Velocity × gain
s("bd sd,hh*8").compressor("-20:20:10:.002:.02") // threshold:ratio:knee:attack:release
```

### Sample Manipulation

```javascript
// Playback position
s("rave").begin("<0 .25 .5 .75>")        // Start point (0-1)
s("bd*2,oh*4").end("<.1 .2 .5 1>")       // End point (0-1)

// Speed and direction
s("bd*6").speed("1 2 4 1 -2 -4")         // Rate (negative = reverse)

// Looping
s("casio").loop(1)
s("space").loop(1).loopBegin(.25).loopEnd(.75)

// Slicing (chop into N pieces, rearrange by index)
s("breaks165").slice(8, "0 1 <2 2*2> 3 [4 0] 5 6 7".every(3, rev))

// Splice (like slice but adjusts speed to match duration)
s("breaks165").splice(8, "0 1 [2 3 0]@2 3 0@2 7")

// Chop (granular — cuts into N pieces played in order)
s("breaks165").chop(16)

// Striate (progressive portions across events)
s("numbers:0 numbers:1").striate(6)

// Fit to duration
s("rhodes").loopAt(2)   // Fit to N cycles
s("rhodes/2").fit()     // Fit to event duration

// Cut groups (stop previous sound in same group)
s("[oh hh]*4").cut(1)
```

### Synthesis

```javascript
// Basic oscillators
note("c2 <eb2 <g2 g1>>".fast(2)).sound("<sawtooth square triangle sine>")

// Harmonic control (additive synthesis)
note("c2").sound("sawtooth").n("<32 16 8 4>")  // Number of partials

// Custom waveforms
note("c3").sound("user").partials([1, 0.5, 0, 0.25])
note("c3").sound("user").partials([1, 0.5]).phases([0, 0.25])

// Wavetable synthesis (samples prefixed wt_ auto-loop)
note("c eb g bb").s("wt_dbass").clip(2)

// Noise
sound("<white pink brown>")
s("crackle*4").density("<0.01 0.04 0.2 0.5>")

// Vibrato
note("a e").vib("<.5 1 2 4 8>")       // Frequency Hz
note("a e").vib(4).vibmod("<.25 .5 1>") // Depth

// FM synthesis
note("c e g b g e")
  .fm("<0 1 2 8 32>")           // Modulation index
  .fmh("<1 2 1.5 1.61>")        // Harmonicity ratio
  .fmattack("<0 .05 .1>")       // FM envelope attack
  .fmdecay("<.01 .05 .1>")      // FM envelope decay
  .fmsustain("<1 .75 .5 0>")    // FM envelope sustain
  .fmenv("<exp lin>")            // Envelope curve
```

## Signals and Continuous Patterns

Signals are continuous patterns with infinite temporal resolution.

### Basic Signals

```javascript
// Unipolar (0 to 1)
sine, cosine, saw, tri, square, rand, perlin

// Bipolar (-1 to 1)
sine2, cosine2, saw2, tri2, square2, rand2

// Integer random
irand(n)  // Random integers 0 to n-1
```

### Signal Transformations

```javascript
sine.range(500, 4000)        // Map 0-1 to range
sine.rangex(500, 4000)       // Exponential mapping (good for frequency)
sine2.range2(500, 4000)      // Map -1..1 to range
sine.slow(4)                 // Slow down LFO
perlin.range(500, 2000)      // Smooth random
tri.range(100, 5000).segment(16)  // Discretize to 16 steps
```

### Common Signal Patterns

```javascript
// Filter sweep
.lpf(sine.range(300, 2000).slow(16))

// Random gain variation (cycle-deterministic — safe for rebuilds)
.gain(rand.range(0.2, 0.4))

// Generative melody
note(saw.range(0, 15).segment(8).scale("C:minor"))

// Pan modulation
.pan(sine.range(0.3, 0.7).slow(4))
```

## Pattern Alignment Strategies

When combining patterns with different structures:

```javascript
// .in (default) — right values applied into left structure
'0 [1 2] 3'.add('10 20')  // '10 [11 12] 23'

// .out — left values applied out to right structure
'0 1 2'.add.out('10 20')

// .mix — structures combined, events at intersections
'0 1 2'.add.mix('10 20')

// .squeeze — right cycles squeezed into left events
"0 1 2".add.squeeze("10 20")  // "[10 20] [11 21] [12 22]"

// .squeezeout — left cycles squeezed into right events
"0 1 2".add.squeezeout("10 20")  // "[10 11 12] [20 21 22]"

// .reset — right cycles truncated to fit left events
"0 1 2 3 4 5 6 7".add.reset("10 [20 30]")

// .restart — like reset but from cycle 0
"0 1 2 3".add.restart("10 20")
```

## Custom Functions

```javascript
// register() creates chainable methods
register("myTransform", (n, pat) => pat.fast(n).rev())
note("c d e f").myTransform(2)
```
