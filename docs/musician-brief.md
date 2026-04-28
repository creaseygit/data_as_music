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

Each listener has a single **sensitivity slider** (0–100%) — a unified "how reactive should the music be?" knob. You don't need to handle it — every signal you receive is already scaled before it reaches your track. But it's worth understanding what it does, because the same market sounds *very* different at the two ends:

| Sensitivity | What changes | Listener experience |
| --- | --- | --- |
| High (100%) | Tight band thresholds (~0.1¢/0.5¢/1¢), short lookback (~15s), inflated activity signals | Every wiggle fires a melody phrase. Drums get busy on small heat blips. |
| Default (50%) | Standard bands (0.5¢/2¢/5¢), ~4-min lookback | Balanced — most listeners want this. |
| Low (0%) | Wide bands (2¢/8¢/20¢), 1-hr lookback, dampened activity signals | Only sustained, large moves play any melody at all. Drums stay calm. |

Crucially, the band shape stays the same at every setting — three magnitude bands, deadzone in the middle. The slider just scales what counts as "small" vs "large". So a track that fires "8-note UP at large band" still fires; the slider only redefines how big a move needs to be to land in that band. **Dynamic range is preserved.**

This means the same market at different sensitivities will feel very different — one listener's "the melody is going wild" might be another's "totally silent" because they've drawn the threshold lines in different places.

## Existing Tracks — What's Already Been Done

### Late Night in Bb (jazz trio)
Full jazz piano trio with two harmonic worlds: bullish (Bb major, ii-V-I-IV) and bearish (G minor, iiø-V-i-iv). `tone` switches between them. `trade_rate` + `velocity` drive the intensity band — low is sparse quarter-note walks, mid adds ghost snares and eighth-note approaches, high adds chromatic runs and kick bombs. `heat` scales overall volume. **Bass and chord cycling follow `momentum`** — the longer-term trend mood. **Melody follows the Weather Vane pattern** — silent when price isn't ticking, ascending/descending phrases picked by the sign and size of the recent cents move. The trio plays without melody on flat markets — the bass, comp and drums carry the room tone. Volatility makes the piano slightly detuned, increases delay feedback, and darkens the bass (lower LPF) — uncertainty makes the whole trio sound muddier and more unsettled.

### Digging in the Markets (lo-fi hip hop)
Dusty, mellow lo-fi beats (~80 BPM). Swung drums, warm sine bass, Rhodes comping, sparse pentatonic melodies, vinyl texture. Bullish = Bb major, bearish = G minor — flat keys for that warm lo-fi register. `heat` controls layer density (sparse → full kit). `trade_rate` + `velocity` drive the intensity band: rim shots → swung 8ths → dropout 16ths. Momentum drives the Rhodes voicings, bass walk and pad progression. **Melody follows the Weather Vane pattern** — silent when price isn't ticking, direction and phrase length set by the recent cents move. Volatility adds reverb, detuning, and wobble. Price tints the global filter warmth.

### So Over, So Back (meme sampler)
Single voice; six vocal samples on a signed intensity ladder. **Same Weather Vane gate** — silent when price isn't ticking. The server-decided band picks both which sample plays and how often it fires. Small down → "over" every ~9s; medium down → "so over" every ~6s; large down → "so fucking over" every cycle. Mirror set on the up side: "back" / "so back" / "so fucking back". The six samples line up 1:1 with the Now-Playing delta gauge cells, at every sensitivity setting.

### Weather Vane (alert track)
Single-voice vibraphone that indicates price direction. Silent whenever the price isn't ticking this cycle. Gated on `price_moving` (true iff the mid changed ≥0.05¢ this tick) so the voice stops the instant movement stops — no lingering melody after a move ends. When the gate is open, scale length comes from the server-decided magnitude band: 3-note run at small, 5-note run at medium, 8-note octave run at large. Direction = sign of the band; scale = major when bullish, minor when bearish. The sensitivity slider stretches the band thresholds, so cranking it up makes the same small wiggle reach a higher band, while cranking it down means only sustained large moves register. No drums, no chords — direction-only, by design. **The same gating + magnitude pattern is now the canonical "melody from price" recipe — Late Night in Bb, Digging in the Markets, and So Over, So Back all use it for their melody/voice.**

## Tools for Tuning

- **Sandbox & Mastering** (`/sandbox`) — no live market needed. Use sliders to simulate any market condition (try the presets: Bull Run, Crash, Dead Market, Chaos, Breakout, Calm Trend). Sweep signals from 0→1 to hear the full dynamic range. Fire test events (spikes, price moves, resolutions). Adjust the volume of each voice (bass, melody, drums, etc.) independently with per-voice gain sliders. Solo or mute individual voices. Export your levels as JSON and send to the dev team to suggest mastering updates.

## Quick Reference Card

```
CONTINUOUS (every 3 seconds):
  heat                0–1       Energy level (master dial)
  price               0–1       Where the market is
  price_moving        bool      Price ticked this cycle (gate — silence when false)
  price_delta_band   -3..+3     Server-decided magnitude band (sign=direction, |band|=size, 0=silence)
  price_delta_cents   ±cents    Raw cents moved over lookback (for gain saturation)
  price_move         -1–1       Legacy unitless integrator
  momentum           -1–1       Sustained trend direction (section mood)
  velocity            0–1       Speed of change (unsigned)
  volatility          0–1       Erratic-ness / uncertainty
  trade_rate          0–1       Trading frequency
  spread              0–1       Order book gap
  tone                0|1       Bullish (1) or bearish (0)

EVENTS (one-shot):
  spike        magnitude 0–1
  price_step   direction 1|-1, magnitude 0–1
  resolved     result 1|-1
```
