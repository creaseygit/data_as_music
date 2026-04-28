// ── Digging in the Markets ────────────────────────────
// Dusty, mellow lo-fi hip hop beats. Swung drums, data-driven Rhodes
// comping, warm sine bass, sparse pentatonic melodies, vinyl texture.
// Flat keys (Bb major / G minor) for that warm lo-fi register.
// Heat controls layer density; melody only fires when price ticks.
// category: 'music', label: 'Digging in the Markets'
//
// ── DATA SIGNALS ──
// heat            0.0–1.0   Overall market activity — controls layer density
// price           0.0–1.0   Current price — drives filter warmth
// price_moving    bool      Per-tick "did price move" gate for the melody
// price_delta_cents signed¢ Cents move over the lookback — picks melody direction + magnitude
// momentum       -1.0–1.0   Sustained trend direction — Rhodes voicings, bass walk direction
// velocity        0.0–1.0   Price velocity magnitude — part of intensity band
// trade_rate      0.0–1.0   Trades per minute — part of intensity band
// volatility      0.0–1.0   Price oscillation — drives reverb, detuning, wobble
// tone            0 or 1    1=major/bullish (Bb major), 0=minor/bearish (G minor)

const diggingInTheMarkets = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // ════════════════════════════════════════════════════════════

  // ── Kick: muffled, sparse, locks with bass ──
  function kickCode(h, energy, gainMul) {
    const g = (0.30 * energy * gainMul).toFixed(3);
    const gLo = (0.22 * energy * gainMul).toFixed(3);

    let pattern;
    if (h < 0.40) {
      pattern = "bd ~ ~ ~";                      // beat 1 only — gentle pulse
    } else if (h < 0.60) {
      pattern = "bd ~ ~ ~ bd ~ ~ ~";             // beats 1 and 3
    } else {
      pattern = "bd ~ ~ [~ bd] bd ~ ~ ~";        // beat 1, ghost pickup, beat 3
    }

    return `$: s("${pattern}").gain(perlin.range(${gLo}, ${g}))`
      + `.lpf(120).orbit(4);\n`;
  }

  // ── Snare/Rim: filtered, beats 2 and 4 ──
  function snareCode(intBand, energy, gainMul) {
    const g = (0.18 * energy * gainMul).toFixed(3);

    let pattern;
    if (intBand === 0) {
      pattern = "~ rim ~ ~";                      // beat 2 only, rim shot
    } else if (intBand === 1) {
      pattern = "~ rim ~ rim";                    // beats 2 and 4
    } else {
      pattern = "~ sd ~ sd";                      // full snare at high intensity
    }

    return `$: s("${pattern}").gain(${g})`
      + `.lpf(3500).room(0.15)`
      + `.pan(0.45).orbit(4);\n`;
  }

  // ── Hi-hats: swung, velocity-varied — the lo-fi signature ──
  function hihatCode(intBand, energy, volat, gainMul) {
    const gLo = (0.06 * energy * gainMul).toFixed(3);
    const gHi = (0.16 * energy * gainMul).toFixed(3);

    let code;
    if (intBand === 0) {
      code = `$: s("hh*4").gain(perlin.range(${gLo}, ${gHi}))`;
    } else if (intBand === 1) {
      // 8th notes with swing — classic lo-fi hat pattern
      code = `$: s("hh*8").gain(perlin.range(${gLo}, ${gHi}))`
        + `.iter(4)`;
    } else {
      // 16ths with dropout for busy markets
      const degrade = (0.25 + volat * 0.2).toFixed(2);
      code = `$: s("hh*16").gain(perlin.range(${gLo}, ${gHi}))`
        + `.degradeBy(${degrade})`
        + `.sometimes(x => x.gain(${(0.22 * energy * gainMul).toFixed(3)}))`;
    }

    // Swing, aggressive filtering (nothing sparkly), slight open hat interplay
    code += `.swingBy(0.18, 4)`
      + `.lpf(5500).hpf(4500)`
      + `.pan(0.55).orbit(4);\n`;
    return code;
  }

  // ── Rhodes: jazz voicings, data-driven comping ──
  // volatility → rhythmic dropout, velocity → filter, trade_rate → density,
  // momentum magnitude → sustain length, perlin → humanised gain
  function keysCode(tone, momSign, momAbs, intBand, energy, vel, volat, gainMul) {
    let changes;
    if (tone === 1) {
      if (momSign > 0)      changes = "<Bb^7 Cm7 Dm7 Eb^7>";
      else if (momSign < 0) changes = "<Eb^7 Dm7 Cm7 Bb^7>";
      else                  changes = "<Bb^7 Gm7 Cm7 F7>";
    } else {
      if (momSign > 0)      changes = "<Gm7 Bb^7 Cm7 Dm7>";
      else if (momSign < 0) changes = "<Dm7 Cm7 Bb^7 Gm7>";
      else                  changes = "<Gm7 Eb^7 Cm7 D7>";
    }

    const gLo = (0.10 * energy * gainMul).toFixed(3);
    const gHi = (0.22 * energy * gainMul).toFixed(3);

    // Comping rhythm driven by intensity band
    let struct;
    if (intBand === 0) {
      // Sparse — one or two hits per bar, randomised placement
      struct = "[~ x] [~ [~|x]] [~|x] ~";
    } else if (intBand === 1) {
      // Medium — offbeat stabs with variation
      struct = "~ [~@2 x] [~|x] [~@2 x|~]";
    } else {
      // Busy — syncopated comping with fills
      struct = "[~|x] [~@2 x] [~ x] [~@2 x|~]";
    }

    // Volatility → dropout: volatile markets get unpredictable gaps
    const degrade = (0.1 + volat * 0.35).toFixed(2);

    // Velocity → filter warmth: faster moves = brighter Rhodes (2000–4500 Hz)
    const lpf = Math.round(2000 + vel * 2500);

    // Momentum magnitude → sustain: strong trends hold chords, flat = staccato
    const decay = (0.15 + momAbs * 0.45).toFixed(2);
    const sustain = (0.1 + momAbs * 0.4).toFixed(2);

    return `$: chord("${changes}").dict("ireal").voicing()`
      + `.struct("${struct}")`
      + `.degradeBy(${degrade})`
      + `.s("gm_epiano1")`
      + `.decay(${decay}).sustain(${sustain})`
      + `.gain(perlin.range(${gLo}, ${gHi}))`
      + `.lpf(${lpf})`
      + `.room(0.25).rsize(2.5)`
      + `.pan(0.45).orbit(1);\n`;
  }

  // ── Bass: warm sine, simple roots ──
  function bassCode(tone, momSign, intBand, energy, gainMul) {
    const g = (0.28 * energy * gainMul).toFixed(3);

    let bassPattern;
    if (tone === 1) {
      // Bb major — bass follows chord roots (Bb,Cm,Dm,Eb)
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[Bb1 ~ D2 ~] [C2 ~ Eb2 ~] [D2 ~ F2 ~] [Eb2 ~ G2 ~]>";
        else if (momSign < 0) bassPattern = "<[Eb2 ~ D2 ~] [D2 ~ C2 ~] [C2 ~ Bb1 ~] [Bb1 ~ A1 ~]>";
        else                  bassPattern = "<[Bb1 ~ ~ ~] [G1 ~ ~ ~] [C2 ~ ~ ~] [F1 ~ ~ ~]>";
      } else {
        if (momSign > 0)      bassPattern = "<Bb1 C2 D2 Eb2>";
        else if (momSign < 0) bassPattern = "<Eb2 D2 C2 Bb1>";
        else                  bassPattern = "<Bb1 G1 C2 F1>";
      }
    } else {
      // G minor — bass follows chord roots (Gm,Bb,Cm,Dm)
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[G1 ~ Bb1 ~] [Bb1 ~ D2 ~] [C2 ~ Eb2 ~] [D2 ~ F2 ~]>";
        else if (momSign < 0) bassPattern = "<[D2 ~ C2 ~] [C2 ~ Bb1 ~] [Bb1 ~ A1 ~] [A1 ~ G1 ~]>";
        else                  bassPattern = "<[G1 ~ ~ ~] [Eb1 ~ ~ ~] [C2 ~ ~ ~] [D2 ~ ~ ~]>";
      } else {
        if (momSign > 0)      bassPattern = "<G1 Bb1 C2 D2>";
        else if (momSign < 0) bassPattern = "<D2 C2 Bb1 G1>";
        else                  bassPattern = "<G1 Eb1 C2 D2>";
      }
    }

    return `$: note("${bassPattern}").s("sine")`
      + `.lpf(350).decay(0.5).sustain(0.4)`
      + `.gain(${g}).orbit(3);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // MELODY MOTIF SYSTEM
  // ════════════════════════════════════════════════════════════
  //
  // Seed motif: [0,1,2,4] (pentatonic degrees) = "do re mi sol"
  //   — 3 steps + 1 leap, asymmetric, clear direction
  //   — Inversion for falling: [4,2,1,0]
  //
  // 8-bar phrases via <> cycling. Bars 1 & 8 = core motif anchor.
  // Bars 2-7 = variations (neighbour, sequence, extension, truncation,
  // enclosure, retrograde answer). "Depart and return."
  //
  // 3 magnitude bands × 2 directions = 6 phrase sets.
  // Magnitude bands match Weather Vane: 0.5–2¢ LOW, 2–5¢ MED, ≥5¢ HIGH.
  // No "flat" set — melody is gated silent when price isn't moving.
  // Intensity (intBand) handled by degradeBy + embellishment, not
  // separate patterns — keeps the motif identity consistent.

  // ── Rising phrases (price ticking up) ──
  // Seed: [0,1,2,4] sequenced upward

  // Low magnitude — sparse, tentative. Motif hinted, completes only at bar 8
  const MOTIF_RISE_LOW = `<
    [[0 1 2 ~] [~ ~ ~ ~] [2 1 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[1 2 3 ~] [~ ~ ~ ~] [3 2 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 2 ~] [~ ~ ~ ~] [1 2 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 2 1 ~] [~ ~ ~ ~] [1 2 ~ ~] [~ ~ ~ ~]]
    [[0 1 2 4] [~ ~ ~ ~] [4 2 ~ ~] [~ ~ ~ ~]]
  >`;

  // Medium magnitude — clear climb, variations, all bars present
  const MOTIF_RISE_MED = `<
    [[0 1 2 4] [4 2 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 3 2] [2 4 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[1 2 3 5] [5 3 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[2 3 4 3] [2 4 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 2 ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[1 2 4 2] [1 2 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 2 1 ~] [0 1 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 2 4] [4 2 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
  >`;

  // High magnitude — sweeping sequence, relentless climb
  const MOTIF_RISE_HIGH = `<
    [[0 1 2 4] [4 2 1 2] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[1 2 3 5] [5 3 2 3] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[2 3 4 6] [6 4 3 4] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 4 5 4] [3 4 5 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 4 5 7] [7 5 4 5] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 5 6 5] [4 5 6 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[6 4 2 ~] [0 1 2 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 2 4] [4 5 6 4] [~ ~ ~ ~] [~ ~ ~ ~]]
  >`;

  // ── Falling phrases (price ticking down) ──
  // Seed inverted: [4,2,1,0] sequenced downward

  // Low magnitude — sparse, tentative descent
  const MOTIF_FALL_LOW = `<
    [[4 3 2 ~] [~ ~ ~ ~] [2 3 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 2 1 ~] [~ ~ ~ ~] [1 2 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 3 2 ~] [~ ~ ~ ~] [3 2 ~ ~] [~ ~ ~ ~]]
    [[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[1 2 3 ~] [~ ~ ~ ~] [2 1 ~ ~] [~ ~ ~ ~]]
    [[4 2 1 0] [~ ~ ~ ~] [0 1 ~ ~] [~ ~ ~ ~]]
  >`;

  // Medium magnitude — clear descent with development
  const MOTIF_FALL_MED = `<
    [[4 2 1 0] [0 2 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 2 1 2] [1 0 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 1 0 ~] [0 1 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[2 1 0 1] [2 0 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 3 2 ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 2 0 2] [1 0 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 1 2 ~] [2 1 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 2 1 0] [0 2 ~ ~] [~ ~ ~ ~] [~ ~ ~ ~]]
  >`;

  // High magnitude — sweeping descent
  const MOTIF_FALL_HIGH = `<
    [[7 5 4 2] [2 4 5 4] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[6 4 3 1] [1 3 4 3] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[5 3 2 0] [0 2 3 2] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[3 2 1 2] [3 1 0 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 2 1 0] [0 1 2 1] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[2 1 0 1] [0 1 0 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[0 2 3 ~] [3 2 1 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
    [[4 2 1 0] [0 1 0 ~] [~ ~ ~ ~] [~ ~ ~ ~]]
  >`;

  // ── Melody: motif-based phrases with delay ──
  // Direction + magnitude come from server-decided price_delta_band
  // (-3..+3, sensitivity-scaled). Intensity (intBand) only adds octave
  // embellishment — it doesn't pick the phrase set. Raw cents still
  // shapes the gain saturation curve so loudness within a band scales
  // with the actual move size.
  function melodyCode(tone, band, dCents, intBand, volat, gainMul) {
    const mag = Math.abs(band);
    const dir = band > 0 ? 1 : -1;
    const scale = "Bb4:pentatonic"; // always — direction conveys mood, not mode

    // Direction × magnitude band selects the phrase set.
    let melodyPattern;
    if (dir > 0) {
      melodyPattern = mag >= 3 ? MOTIF_RISE_HIGH
                    : mag >= 2 ? MOTIF_RISE_MED
                    : MOTIF_RISE_LOW;
    } else {
      melodyPattern = mag >= 3 ? MOTIF_FALL_HIGH
                    : mag >= 2 ? MOTIF_FALL_MED
                    : MOTIF_FALL_LOW;
    }

    // Cents saturation → gain. Mirrors Weather Vane shape: ramp from
    // 0.10 at the gate to ~0.22 at saturation (≥10¢ raw move).
    const sat = Math.min(1.0, Math.abs(dCents) / 10.0);
    const g = ((0.10 + sat * 0.12) * gainMul).toFixed(3);

    // Volatility → note dropout (uncertain markets = fragmented phrasing)
    const degradeAmt = (0.10 + volat * 0.25).toFixed(2);
    const delaytime = (60 / 80 / 2).toFixed(4);  // 8th note delay

    // Intensity embellishment: high intBand adds occasional octave reinforcement
    const embellish = intBand >= 2
      ? (dir < 0
          ? `.rarely(x => x.add(note(-5)))`
          : `.rarely(x => x.add(note(5)))`)
      : '';

    return `$: note(\`${melodyPattern}\`).scale("${scale}")`
      + `.degradeBy(${degradeAmt})`
      + embellish
      + `.s("piano").decay(0.35).sustain(0)`
      + `.lpf(2500)`
      + `.gain(${g}).room(0.3).rsize(2.5)`
      + `.delay(0.25).delaytime(${delaytime}).delayfeedback(0.4)`
      + `.pan(0.4).orbit(2);\n`;
  }

  // ── Texture: vinyl crackle — filtered pink noise ──
  function textureCode(energy, gainMul) {
    // Stays relatively constant — the dusty atmosphere
    const g = (0.04 * (0.4 + energy * 0.6) * gainMul).toFixed(3);
    return `$: s("pink").gain(${g})`
      + `.lpf(3500).hpf(600)`
      + `.room(0.1).pan(0.5).orbit(5);\n`;
  }

  // ── Pad: warm triangle underneath, slow-moving ──
  function padCode(tone, momSign, energy, volat, gainMul) {
    const g = (0.08 * energy * gainMul).toFixed(3);

    let padNotes;
    if (tone === 1) {
      // Bb major — triads matching the keys chord progression
      if (momSign > 0)      padNotes = "<[Bb3,D4,F4] [C4,Eb4,G4] [D4,F4,A4] [Eb4,G4,Bb4]>";
      else if (momSign < 0) padNotes = "<[Eb4,G4,Bb4] [D4,F4,A4] [C4,Eb4,G4] [Bb3,D4,F4]>";
      else                  padNotes = "<[Bb3,D4,F4] [G3,Bb3,D4] [C4,Eb4,G4] [F3,A3,C4]>";
    } else {
      // G minor — triads matching the keys chord progression
      if (momSign > 0)      padNotes = "<[G3,Bb3,D4] [Bb3,D4,F4] [C4,Eb4,G4] [D4,F4,A4]>";
      else if (momSign < 0) padNotes = "<[D4,F4,A4] [C4,Eb4,G4] [Bb3,D4,F4] [G3,Bb3,D4]>";
      else                  padNotes = "<[G3,Bb3,D4] [Eb3,G3,Bb3] [C3,Eb3,G3] [D3,F#3,A3]>";
    }

    const reverbWet = (0.35 + volat * 0.3).toFixed(2);
    const roomSize = (2.5 + volat * 3).toFixed(1);

    return `$: note("${padNotes}").s("triangle")`
      + `.attack(1.2).release(2.5).sustain(0.5)`
      + `.gain(${g}).lpf(${Math.round(1200 + energy * 600)})`
      + `.room(${reverbWet}).rsize(${roomSize})`
      + `.pan(sine.range(0.35, 0.65).slow(16))`
      + `.orbit(1);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // TRACK OBJECT
  // ════════════════════════════════════════════════════════════

  return {
    name: "digging_in_the_markets",
    label: "Digging in the Markets",
    category: "music",
    cpm: 20,  // 80 BPM / 4 = 20 cpm

    voices: {
      kick:    { label: "Kick",    default: 1.0 },
      snare:   { label: "Snare",   default: 1.0 },
      hihat:   { label: "Hi-Hat",  default: 1.0 },
      keys:    { label: "Keys",    default: 1.0 },
      bass:    { label: "Bass",    default: 1.0 },
      melody:  { label: "Melody",  default: 1.0, meter: 'delta' },
      texture: { label: "Texture", default: 1.0 },
      pad:     { label: "Pad",     default: 1.0 },
    },

    gains: {},

    getGain(voice) {
      return this.gains[voice] ?? this.voices[voice]?.default ?? 1.0;
    },

    init() {
      _cachedCode = null;
      _cachedKey = null;
    },

    evaluateCode(data) {
      // ── 1. Extract & quantize signals ──
      const h     = q(data.heat || 0, 0.05);
      const tone  = data.tone !== undefined ? data.tone : 1;
      const tr    = q(data.trade_rate || 0, 0.1);
      const vel   = q(data.velocity || 0, 0.1);
      const volat = q(data.volatility || 0, 0.1);
      const mom   = q(data.momentum || 0, 0.1);
      const dCents = data.price_delta_cents || 0;
      const serverBand = data.price_delta_band ?? 0;  // -3..+3, server-decided
      const moving = data.price_moving === true;

      // ── 2. Derived values ──
      const rawIntensity = 0.6 * tr + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
      const energy = h;  // raw heat — silence is valid at 0
      const momSign = Math.abs(mom) < 0.15 ? 0 : (mom > 0 ? 1 : -1);

      // Melody gate: same two-signal rule as Weather Vane.
      // serverBand is 0 inside the deadzone, so the band itself acts as
      // the magnitude gate. Plus per-tick price_moving for "is the price
      // ticking right now".
      const melodyBand = moving ? serverBand : 0;
      const melodyOn = melodyBand !== 0;

      // ── 3. Cache check ──
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      // Quantize cents to 0.5¢ steps — keeps the gain-saturation curve
      // stable across tiny variations without re-evaluating every tick.
      const centsKey = Math.round(dCents * 2) / 2;
      const melodyKey = melodyOn ? `${melodyBand}@${centsKey}` : 'off';
      const key = `${h}:${tone}:${intBand}:${volat}:${mom}:${melodyKey}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // ── 4. Build code ──
      let code = "setcpm(20);\n\n";

      // Texture (vinyl crackle) — first to appear, last to go
      code += h > 0.05
        ? textureCode(energy, this.getGain('texture'))
        : '$: silence;\n';

      // Pad — warm foundation under everything
      code += h > 0.10
        ? padCode(tone, momSign, energy, volat, this.getGain('pad'))
        : '$: silence;\n';

      // Rhodes — comping driven by volatility, velocity, trade density
      code += h > 0.25
        ? keysCode(tone, momSign, Math.abs(mom), intBand, energy, vel, volat, this.getGain('keys'))
        : '$: silence;\n';

      // Bass — warm sine, enters before drums
      code += h > 0.20
        ? bassCode(tone, momSign, intBand, energy, this.getGain('bass'))
        : '$: silence;\n';

      // Kick — muffled, enters with the groove
      code += h > 0.25
        ? kickCode(h, energy, this.getGain('kick'))
        : '$: silence;\n';

      // Snare/Rim — filtered backbeat
      code += h > 0.30
        ? snareCode(intBand, energy, this.getGain('snare'))
        : '$: silence;\n';

      // Hi-hats — swung, the lo-fi signature
      code += h > 0.25
        ? hihatCode(intBand, energy, volat, this.getGain('hihat'))
        : '$: silence;\n';

      // Melody — fires only when price is actually ticking and the
      // server-decided band is non-zero. Direction + magnitude come from
      // price_delta_band; raw cents shapes the gain-saturation curve.
      // Heat/momentum no longer gate it (the rest of the band conveys
      // trading volume).
      code += melodyOn
        ? melodyCode(tone, melodyBand, dCents, intBand, volat, this.getGain('melody'))
        : '$: silence;\n';

      // ── 5. Cache and return ──
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        // Soft open hat — nothing harsh
        const gain = (0.015 + (msg.magnitude || 0.5) * 0.02).toFixed(3);
        return `$: s("<oh:3 ~ ~ ~>").gain(${gain}).lpf(4000).room(0.4).orbit(5);`;
      }
      if (type === "price_step") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.02 + mag * 0.03).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const scale = "Bb4:pentatonic"; // always — direction conveys mood, not mode
        // Use the seed motif for events too — reinforces the melodic identity
        const run = dir > 0 ? "[0 1 2 4]" : "[4 2 1 0]";
        return `$: note("${run}").scale("${scale}")`
          + `.s("piano").decay(0.3).sustain(0)`
          + `.gain(${gain}).lpf(2000)`
          + `.room(0.35).delay(0.25).delayfeedback(0.35)`
          + `.orbit(5);`;
      }
      if (type === "resolved") {
        // Warm Rhodes chord — resolution
        const result = msg.result || 1;
        const chord = result > 0 ? "Bb3,D4,F4,A4" : "G3,Bb3,D4,F4";
        return `$: note("${chord}").s("gm_epiano1")`
          + `.attack(0.5).release(4)`
          + `.gain(0.06).lpf(2500)`
          + `.room(0.5).rsize(4).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("digging_in_the_markets", diggingInTheMarkets);
