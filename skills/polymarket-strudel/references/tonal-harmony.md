# Tonal and Harmonic Reference

Strudel integrates [tonal.js](https://github.com/tonaljs/tonal) for music-theoretic operations: scales, chords, voicings, and transposition. These functions are essential for writing tracks with harmonic depth.

## Scales

Apply a named scale to numeric pattern values (scale degrees):

```javascript
// Numbers become scale degrees (0-indexed)
note("<0 2 4 6>*8").scale("C:minor")
note("0 1 2 3 4 5 6 7").scale("D:dorian")

// Octave included in root
note("0 2 4 6").scale("C4:pentatonic")
```

### Common Scale Names

| Name | Intervals | Character |
|------|-----------|-----------|
| `major` | 1 2 3 4 5 6 7 | Bright, happy |
| `minor` | 1 2 b3 4 5 b6 b7 | Dark, sad |
| `dorian` | 1 2 b3 4 5 6 b7 | Jazz minor, sophisticated |
| `mixolydian` | 1 2 3 4 5 6 b7 | Bluesy, dominant |
| `pentatonic` | 1 2 3 5 6 | Simple, universal |
| `minor pentatonic` | 1 b3 4 5 b7 | Blues, rock |
| `blues` | 1 b3 4 b5 5 b7 | Blues |
| `lydian` | 1 2 3 #4 5 6 7 | Dreamy, floating |
| `phrygian` | 1 b2 b3 4 5 b6 b7 | Dark, Spanish |
| `locrian` | 1 b2 b3 4 b5 b6 b7 | Very dark, unstable |
| `harmonic minor` | 1 2 b3 4 5 b6 7 | Dramatic, classical |
| `melodic minor` | 1 2 b3 4 5 6 7 | Jazz, ascending minor |
| `whole tone` | 1 2 3 #4 #5 b7 | Dreamlike, ambiguous |
| `chromatic` | all 12 | Chromatic |
| `bebop` | 1 2 3 4 5 6 b7 7 | Jazz bebop lines |

## Chords and Voicings

### Chord Symbols

Strudel uses standard chord symbols. Common formats:

```
C        — C major triad
Cm       — C minor triad
C7       — C dominant 7th
Cm7      — C minor 7th
C^7      — C major 7th (also Cmaj7, CΔ7)
Cm7b5    — C half-diminished (also Cø7)
Cdim7    — C diminished 7th
Csus4    — C suspended 4th
C7#9     — C dominant 7th sharp 9 (Hendrix chord)
C6       — C major 6th
Cm9      — C minor 9th
```

### Voicing Chords

The `.voicing()` method distributes chord notes into natural keyboard voicings:

```javascript
// Basic voicing
chord("Cm7 F7 Bb^7 Eb^7").voicing()

// With voicing mode
chord("Cm7 F7 Bb^7").voicing("lefthand")
chord("Cm7 F7 Bb^7").voicing("righthand")
```

### Using Chord Dictionaries

`.dict()` looks up chord symbols in a dictionary. The `"ireal"` dictionary understands iReal Pro / jazz lead sheet notation:

```javascript
// Jazz changes with auto-voicing
let changes = "<Cm7 F7 Bb^7 Eb^7>";
chord(changes).dict("ireal").voicing()

// Apply rhythmic structure to chord voicings
chord(changes).dict("ireal").voicing()
  .struct("~ [~@2 x] ~ [~@2 x]")
  .s("piano")
```

### Voicing with Strudel Patterns

```javascript
// Chord progression with effects
chord("<Am7 Dm7 G7 C^7>")
  .dict("ireal")
  .voicing()
  .s("piano")
  .room(0.3)
  .gain(0.4)

// Arpeggiating voiced chords
chord("<Cm7 F7 Bb^7>")
  .voicing()
  .arp("0 1 2 [0,2]")
  .s("piano")
```

## Transposition

### By Semitones

```javascript
note("c3 e3 g3").transpose(7)           // Up a fifth
note("c3 e3 g3").transpose("<0 5 7>")   // Pattern of transpositions
```

### By Scale Steps

```javascript
// Transpose within a scale (preserves scale membership)
note("0 2 4").scale("C:major").scaleTranspose(2)
// 0→2, 2→4, 4→6 in C major = E G B instead of C E G
```

### Intervals

```javascript
// Interval notation for transposition
note("c3 e3 g3").transpose("1P")    // Unison
note("c3 e3 g3").transpose("3m")    // Minor third up
note("c3 e3 g3").transpose("-5P")   // Fifth down
```

## Root Notes

Extract root notes from chord symbols:

```javascript
// Get just the root of each chord
chord("<Cm7 F7 Bb^7 Eb^7>").rootNotes()
// Returns: C, F, Bb, Eb (one per cycle)
```

## Mode

Select a mode/inversion of a chord:

```javascript
chord("C").mode(0)   // Root position
chord("C").mode(1)   // First inversion
chord("C").mode(2)   // Second inversion
```

## Practical Patterns for Data-Driven Tracks

### Switching Keys with `tone`

```javascript
// Use tone (0=bearish, 1=bullish) to select harmonic world
const changes = tone === 1
  ? "<Cm7 F7 Bb^7 Eb^7>"     // Bright: ii-V-I-IV in Bb major
  : "<Am7b5 D7 Gm7 Cm7>";    // Dark: iiø-V-i-iv in G minor

chord(changes).dict("ireal").voicing().s("piano")
```

### Scale Degree Melodies

```javascript
// Use scale degrees so melody stays in key regardless of tone
const scale = tone === 1 ? "Bb4:major" : "G4:minor";
note("<0 2 4 6>*8").scale(scale).s("piano")
```

### Register Shifts with Momentum

```javascript
// Momentum shifts register: uptrend = higher, downtrend = lower
const regShift = Math.round(momentum * 3);  // -3 to +3 semitones
note("c4 e4 g4").transpose(regShift).s("piano")
```

### Volatility as Harmonic Tension

```javascript
// Low volatility: consonant voicings. High: add tensions
const chordSuffix = volatility > 0.6 ? "7#11" : volatility > 0.3 ? "9" : "^7";
```
