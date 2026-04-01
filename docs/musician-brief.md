# Data as Music — Musician Brief

## What You're Working With

This system turns live prediction market data into music. A prediction market is a betting exchange where people trade on outcomes — "Will X happen?" — and the price reflects the crowd's probability estimate (0¢ = No, 100¢ = Yes). When something happens in the world that changes people's beliefs, the price moves, people trade, and you hear it.

Your job is to write a **track** — a self-contained piece of code that receives market data every 3 seconds and generates audio. You decide what every signal means musically. The system sends you numbers; you turn them into sound.

## The Data You Receive

Every 3 seconds, your track gets a snapshot of what's happening in the market. All values are normalized — no raw dollars or trade counts. Here's what you get:

### The Signals

**Energy — how active is this market?**

| Signal | Range | What it tells you |
| --- | --- | --- |
| `heat` | 0 – 1 | Overall market activity. Composite of everything below. Think of it as a master "energy" dial. |
| `trade_rate` | 0 – 1 | How many people are trading right now. Self-calibrating — 0.5 means "busier than usual for this market." |
| `spread` | 0 – 1 | Gap between buyers and sellers. Low = liquid, confident market. High = thin, uncertain. |

**Price — where is the market, and which way is it going?**

| Signal | Range | What it tells you |
| --- | --- | --- |
| `price` | 0 – 1 | The current probability. 0.5 = total uncertainty. 0.9 = almost certain. 0.1 = almost certainly not. |
| `price_move` | -1 – 1 | "Is something happening RIGHT NOW?" Only non-zero during active movement. Positive = price rising, negative = falling. Goes back to zero once the move stops — it's a phrase trigger, not a sustained value. |
| `momentum` | -1 – 1 | "What's the trend?" Smoothed over minutes, not seconds. Positive = sustained uptrend, negative = sustained downtrend. Near zero = sideways / no conviction. Stays non-zero even after the initial burst fades. |
| `velocity` | 0 – 1 | How fast price is changing, regardless of direction. High velocity = fast market. |

**Character — what does this market feel like?**

| Signal | Range | What it tells you |
| --- | --- | --- |
| `volatility` | 0 – 1 | How erratic the price is. A market bouncing between 48¢ and 52¢ rapidly has high volatility but near-zero momentum — it's uncertain, nervous, undecided. |
| `tone` | 0 or 1 | Binary mood. 1 = bullish (price above 55¢), 0 = bearish (price below 45¢). Has hysteresis so it won't flicker. Use for major/minor key, or any binary musical decision. |

### How to Think About These Musically

| Signal | Musical role | Ideas |
| --- | --- | --- |
| `heat` | **Energy level** | Volume, layer count, rhythmic density, how "full" the arrangement is |
| `price` | **Harmonic position** | Register, note choice. 0.5 = maximum tension/uncertainty. 0.9+ = resolution. Below 0.2 = doom. |
| `price_move` | **Phrase trigger** | Melodic runs, arpeggios, drum fills. Only fires during active movement — use it for momentary gestures. |
| `momentum` | **Section mood** | Build energy during uptrends, pull back during downtrends. Sustained, so it works for section-level decisions. |
| `velocity` | **Pace** | Subdivision, tempo feel, rhythmic urgency |
| `volatility` | **Tension / uncertainty** | Dissonance, detuning, filter wobble, tremolo, irregular rhythms, unsettled textures |
| `trade_rate` | **Complexity** | Drum pattern density, number of voices, melodic ornamentation |
| `spread` | **Liquidity feel** | Wide intervals vs tight clusters, consonance vs dissonance |
| `tone` | **Key / mode** | Major or minor, bright or dark chord voicings |

## Signal Combinations — The Interesting Stuff

Individual signals are useful, but the real musicality comes from combinations:

### The Four Market Moods

| Volatility | Momentum | Market state | Musical character |
| --- | --- | --- | --- |
| **Low** | **Low** | *Quiet* — nothing happening | Ambient, sparse, patient. A market waiting for news. |
| **Low** | **High** | *Steady trend* — calm, confident move | Smooth directional phrases. Walking bass, ascending lines. The market knows where it's going. |
| **High** | **Low** | *Indecision* — bouncing with no direction | Tension, dissonance, nervous energy. Rhythmic instability. The market is arguing with itself. |
| **High** | **High** | *Breakout* — volatile AND directional | Maximum drama. Big energy with clear direction. The moment everyone is watching. |

### Other Combinations Worth Exploring

- **High heat + low price_move** = lots of trading, price isn't moving much. People are churning. Musical: busy rhythms, static harmony.
- **price near 0.5 + high volatility** = genuine uncertainty. Musical: dissonant, unresolved, suspended chords.
- **price near 0.9+ + low volatility** = market has decided, it's over. Musical: resolution, consonance, finality.
- **momentum sign flip** (positive → negative or vice versa) = trend reversal. Natural point for a key change, section break, or dramatic shift.

## Events — One-Shot Moments

On top of the continuous data stream, you'll receive **events** — discrete moments that break the pattern:

| Event | Data | What happened |
| --- | --- | --- |
| `spike` | `magnitude: 0 – 1` | Sudden burst of activity. Something happened. The bigger the magnitude, the more dramatic. |
| `price_move` | `direction: 1 or -1`, `magnitude: 0 – 1` | Significant price jump. Direction tells you which way, magnitude tells you how far. |
| `resolved` | `result: 1 or -1` | The market resolved — the question was answered. 1 = Yes won, -1 = No won. This is the finale. |

**Magnitude matters.** A barely-threshold spike and a massive spike carry different magnitudes. Scale your response — a small spike might get a soft cymbal tap, a large one gets a full crash.

## The Sensitivity Slider

Each listener has a **sensitivity slider** (0 – 1). You don't need to handle this — it's applied before your track receives data. But it's worth understanding what it does:

**Activity signals** (`heat`, `velocity`, `trade_rate`, `spread`, `price_move`) get their amplitude scaled. High sensitivity makes quiet markets sound more active; low sensitivity makes them calmer.

**Trend signals** (`momentum`, `volatility`) get their **analysis window** changed — like switching between short and long moving averages on a trading chart:

| Sensitivity | Window | Analogy |
| --- | --- | --- |
| High (1.0) | ~45 seconds | Scalper — reacts to every blip |
| Default (0.5) | ~2.5 minutes | Day trader — medium-term trends |
| Low (0.0) | ~8 minutes | Swing trader — only sustained moves |

This means the same market at different sensitivities will feel musically different — one listener's "momentum is high" might be another's "momentum is near zero" because they're looking at different time windows.

## The Diagnostic Track

There's a built-in test track called **Data Diagnostic** that plays one identifiable sound per signal. Use it to calibrate your ears:

| What you hear | Where (stereo) | What signal |
| --- | --- | --- |
| Kick drum pulse (faster = higher) | Center | `heat` |
| Sine drone (pitch = value) | Center | `price` |
| Sawtooth sweep (up = positive) | Left | `momentum` |
| Noise wash (louder = higher) | Right | `volatility` |
| Piano arpeggio (up/down) | Left | `price_move` |
| Hi-hat (denser = higher) | Right | `trade_rate` |
| Chord pad (major/minor) | Center | `tone` |
| Cowbell tick (brighter = wider) | Right | `spread` |
| Crash cymbal | Center | `spike` event |
| Vibraphone bell (high/low) | Center | `price_move` event |

Select a live market, listen to the diagnostic track, and watch the data values update in the UI. This is the fastest way to build intuition for what the numbers sound like.

## Existing Tracks — What's Already Been Done

### Oracle (alert track)
Piano chord alert. Silent when nothing is moving. When `price_move` fires, plays ascending or descending triads — more chords for bigger moves. Momentum shifts the chord register up or down (±3 semitones). Volatility increases reverb depth — uncertain markets sound more spacey and ethereal.

### Late Night in Bb (jazz trio)
Full jazz piano trio with two harmonic worlds: bullish (Bb major, ii-V-I-IV) and bearish (G minor, iiø-V-i-iv). `tone` switches between them. `trade_rate` + `velocity` drive the intensity band — low is sparse quarter-note walks, mid adds ghost snares and eighth-note approaches, high adds chromatic runs and kick bombs. `heat` scales overall volume. Momentum keeps the melody alive during sustained trends — it doesn't need an edge-detected move to play. Volatility makes the piano slightly detuned, increases delay feedback, and darkens the bass (lower LPF) — uncertainty makes the whole trio sound muddier and more unsettled.

### Poolside House
Relaxed daytime house (~116 BPM). Layers activate progressively with heat: pad first, then chords, bass, kick+percussion, melody, counter-melody. At rest, the track is completely silent. Bullish = C major Rhodes chords, bearish = A minor. Momentum shifts the melody register up or down and drives melody activation. Volatility fragments the patterns and deepens reverb. Price controls the global filter — higher price = brighter sound.

## Tools for Tuning

- **Mastering page** (`/master`) — adjust the volume of each voice (bass, melody, drums, etc.) independently with per-voice gain sliders. Solo or mute individual voices. Export your levels as JSON.
- **Sandbox page** (`/sandbox`) — no live market needed. Use sliders to simulate any market condition (try the presets: Bull Run, Crash, Dead Market, Chaos, Breakout, Calm Trend). Sweep signals from 0→1 to hear the full dynamic range. Fire test events (spikes, price moves, resolutions).

## Quick Reference Card

```
CONTINUOUS (every 3 seconds):
  heat         0–1      Energy level (master dial)
  price        0–1      Where the market is
  price_move  -1–1      Active movement RIGHT NOW (phrase trigger)
  momentum    -1–1      Sustained trend direction (section mood)
  velocity     0–1      Speed of change (unsigned)
  volatility   0–1      Erratic-ness / uncertainty
  trade_rate   0–1      Trading frequency
  spread       0–1      Order book gap
  tone         0|1      Bullish (1) or bearish (0)

EVENTS (one-shot):
  spike        magnitude 0–1
  price_move   direction 1|-1, magnitude 0–1
  resolved     result 1|-1
```
