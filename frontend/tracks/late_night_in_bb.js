// ── Late Night in Bb — Jazz Piano Trio ───────────────────
// Two tonalities: bullish (Bb major) / bearish (G minor).
// Tone selects major/minor quality; momentum drives the bass walk
// direction and chord cycling. Melody only fires when price is actually
// ticking — its direction and magnitude come from price_delta_cents,
// matching Weather Vane.
// Heat controls layer density — a dead market converges to silence.
// Trade rate + velocity drive rhythmic complexity (intBand).
// Volatility → piano detuning, delay wash, bass darkness.
// category: 'music', label: 'Late Night in Bb'

const jazzTrioTrack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) { return Math.round(v / step) * step; }

  function scaleGains(pattern, factor) {
    return pattern.replace(/\d+\.\d+/g, (m) =>
      (parseFloat(m) * factor).toFixed(3)
    );
  }

  // ── Chord changes ──
  const BULLISH_CHANGES = "<Cm7 F7 Bb^7 Eb^7 Cm7 F7 Bb^7 Bb^7>";
  const BEARISH_CHANGES = "<Am7b5 D7 Gm7 Cm7 Am7b5 D7 Gm7 Gm7>";

  // ════════════════════════════════════════════════════════════
  // BASS PATTERNS — indexed by [intBand] (0=sparse, 1=mid, 2=busy)
  // Selected by tone (Bb major/G minor) × direction (up/down/flat)
  // Direction from momentum sign, melodic range from melodicBand
  // ════════════════════════════════════════════════════════════

  // Bb major — ascending bass (walking UP through chord tones)
  // Cm7 | F7 | Bb^7 | Eb^7 | Cm7 | F7 | Bb^7 | Bb^7
  const BB_BASS_UP = [
    // intBand 0: quarter-note ascending arpeggios
    `<
  [C2 D2 Eb2 E2]
  [F2 A2 Bb2 A2]
  [Bb2 C3 D3 D2]
  [Eb2 F2 G2 Bb2]
  [C2 Eb2 G2 E2]
  [F2 G2 A2 Bb2]
  [Bb2 D3 C3 A2]
  [Bb2 A2 C3 Bb2]
>`,
    // intBand 1: eighth-note approaches on beat 4
    `<
  [C2 Eb2 G2 [Bb2 E2]]
  [F2 A2 C3 [Bb2 A2]]
  [Bb2 D3 C3 [Eb3 D2]]
  [Eb2 G2 Bb2 [A2 B2]]
  [C2 D2 Eb2 [G2 E2]]
  [F2 A2 Bb2 [C3 A2]]
  [Bb2 C3 D3 Bb2]
  [Bb2 D3 [C3 D3] Bb2]
>`,
    // intBand 2: busy chromatic ascending fills
    `<
  [C2 [D2 Eb2] G2 [A2 E2]]
  [F2 [G2 A2] C3 [Bb2 A2]]
  [[Bb2 C3] D3 C3 [Eb3 D2]]
  [Eb2 [F2 G2] Bb2 [A2 B2]]
  [[C2 Eb2] G2 [Bb2 A2] E2]
  [[F2 A2] C3 [Bb2 C3] A2]
  [[Bb2 D3] C3 D3 [Eb3 Bb2]]
  [Bb2 [C3 D3] [Eb3 D3] Bb2]
>`,
  ];

  // Bb major — descending bass (walking DOWN through chord tones)
  const BB_BASS_DOWN = [
    // intBand 0: quarter-note descending arpeggios
    `<
  [Bb2 G2 Eb2 C2]
  [C3 A2 F2 Eb2]
  [A2 F2 D2 Bb1]
  [Bb2 G2 Eb2 D2]
  [G2 Eb2 C2 Bb1]
  [A2 F2 Eb2 C2]
  [D3 Bb2 F2 D2]
  [Bb2 A2 F2 D2]
>`,
    // intBand 1: eighth-note descending approaches
    `<
  [Bb2 G2 Eb2 [D2 C2]]
  [C3 A2 [G2 F2] Eb2]
  [A2 F2 D2 [Eb2 Bb1]]
  [Bb2 G2 [F2 Eb2] D2]
  [G2 Eb2 C2 [D2 Bb1]]
  [A2 [G2 F2] Eb2 C2]
  [D3 [C3 Bb2] F2 D2]
  [Bb2 [A2 G2] F2 D2]
>`,
    // intBand 2: busy descending chromatic runs
    `<
  [[Bb2 A2] G2 [F2 Eb2] C2]
  [[C3 Bb2] A2 [G2 F2] Eb2]
  [[A2 G2] F2 [Eb2 D2] Bb1]
  [[Bb2 Ab2] G2 [F2 Eb2] D2]
  [[G2 F2] Eb2 [D2 C2] Bb1]
  [[A2 G2] F2 [Eb2 D2] C2]
  [[D3 C3] Bb2 [A2 F2] D2]
  [[Bb2 A2] [G2 F2] [Eb2 D2] Bb1]
>`,
  ];

  // Bb major — flat bass (minimal movement, roots + neighbors)
  const BB_BASS_FLAT = [
    // intBand 0: whole notes on chord roots
    `<[C2 ~ ~ ~] [F2 ~ ~ ~] [Bb1 ~ ~ ~] [Eb2 ~ ~ ~] [C2 ~ ~ ~] [F2 ~ ~ ~] [Bb1 ~ ~ ~] [Bb1 ~ ~ ~]>`,
    // intBand 1: half notes, root and 5th
    `<[C2 ~ G2 ~] [F2 ~ C3 ~] [Bb1 ~ F2 ~] [Eb2 ~ Bb2 ~] [C2 ~ G2 ~] [F2 ~ C3 ~] [Bb1 ~ F2 ~] [Bb1 ~ F2 ~]>`,
    // intBand 2: quarter notes, small intervals around roots
    `<[C2 D2 C2 Bb1] [F2 G2 F2 Eb2] [Bb1 C2 D2 Bb1] [Eb2 F2 Eb2 D2] [C2 Bb1 C2 D2] [F2 Eb2 F2 G2] [Bb1 D2 C2 Bb1] [Bb1 C2 Bb1 A1]>`,
  ];

  // G minor — ascending bass (walking UP through chord tones)
  // Am7b5 | D7 | Gm7 | Cm7 | Am7b5 | D7 | Gm7 | Gm7
  const GM_BASS_UP = [
    // intBand 0: quarter-note ascending arpeggios
    `<
  [A1 C2 Eb2 G2]
  [D2 F#2 A2 C3]
  [G1 Bb1 D2 G2]
  [C2 Eb2 G2 Bb2]
  [A1 Eb2 G2 A2]
  [D2 F#2 A2 C3]
  [G1 D2 Bb2 D3]
  [G2 Bb2 C3 D3]
>`,
    // intBand 1: eighth-note ascending approaches
    `<
  [A1 C2 Eb2 [F2 G2]]
  [D2 F#2 [G2 A2] C3]
  [G1 Bb1 D2 [Eb2 G2]]
  [C2 Eb2 [F2 G2] Bb2]
  [A1 [Bb1 C2] Eb2 G2]
  [D2 [Eb2 F#2] A2 C3]
  [G1 [A1 Bb1] D2 G2]
  [G2 [A2 Bb2] C3 D3]
>`,
    // intBand 2: busy ascending chromatic fills
    `<
  [A1 [Bb1 C2] Eb2 [F2 G2]]
  [[D2 Eb2] F#2 [G2 A2] C3]
  [G1 [A1 Bb1] [C2 D2] G2]
  [C2 [D2 Eb2] [F2 G2] Bb2]
  [[A1 C2] Eb2 [F2 G2] A2]
  [D2 [Eb2 F#2] [A2 Bb2] C3]
  [[G1 Bb1] D2 [Eb2 F2] G2]
  [G2 [A2 Bb2] [C3 D3] D3]
>`,
  ];

  // G minor — descending bass (walking DOWN through chord tones)
  const GM_BASS_DOWN = [
    // intBand 0: quarter-note descending arpeggios
    `<
  [A2 G2 Eb2 D2]
  [D3 C3 A2 Ab2]
  [G2 F2 D2 C2]
  [C3 Bb2 Ab2 Bb2]
  [A2 Eb2 C2 D2]
  [D3 A2 F#2 Ab2]
  [G2 F2 D2 Bb1]
  [G2 F2 Eb2 D2]
>`,
    // intBand 1: eighth-note descending approaches
    `<
  [A2 G2 Eb2 [C2 D2]]
  [D3 C3 A2 [Bb2 Ab2]]
  [G2 F2 D2 [Eb2 C2]]
  [C3 Bb2 G2 [A2 Bb2]]
  [A2 [G2 Eb2] C2 D2]
  [D3 [C3 A2] F#2 Ab2]
  [G2 [F2 D2] Bb1 C2]
  [G2 [Bb2 A2] F2 G2]
>`,
    // intBand 2: busy descending chromatic runs
    `<
  [[A2 G2] Eb2 C2 [Eb2 D2]]
  [[D3 C3] A2 F#2 [Bb2 Ab2]]
  [[G2 F2] D2 Bb1 [Eb2 C2]]
  [[C3 Bb2] Ab2 G2 [A2 Bb2]]
  [A2 [G2 Eb2] [C2 Eb2] D2]
  [[D3 C3] [A2 F#2] C3 Ab2]
  [G2 [F2 D2] [Bb1 D2] C2]
  [G2 [Bb2 A2] [F2 Eb2] G1]
>`,
  ];

  // G minor — flat bass (roots + neighbors)
  const GM_BASS_FLAT = [
    // intBand 0: whole notes on chord roots
    `<[A1 ~ ~ ~] [D2 ~ ~ ~] [G1 ~ ~ ~] [C2 ~ ~ ~] [A1 ~ ~ ~] [D2 ~ ~ ~] [G1 ~ ~ ~] [G1 ~ ~ ~]>`,
    // intBand 1: half notes, root and 5th
    `<[A1 ~ Eb2 ~] [D2 ~ A2 ~] [G1 ~ D2 ~] [C2 ~ G2 ~] [A1 ~ Eb2 ~] [D2 ~ A2 ~] [G1 ~ D2 ~] [G1 ~ D2 ~]>`,
    // intBand 2: quarter notes, small intervals around roots
    `<[A1 Bb1 A1 G1] [D2 Eb2 D2 C2] [G1 A1 Bb1 G1] [C2 D2 C2 Bb1] [A1 G1 A1 Bb1] [D2 C2 D2 Eb2] [G1 Bb1 A1 G1] [G1 A1 G1 F#1]>`,
  ];

  // Shared bass gain pattern (16 bars, scaled by energy × gainMul)
  const BASS_GAINS = `<
  [0.45 0.35 0.35 0.30]
  [0.45 0.38 0.32 0.30]
  [0.45 0.35 0.35 0.32]
  [0.45 0.35 0.35 0.30]
  [0.45 0.35 0.35 0.30]
  [0.45 0.38 0.35 0.30]
  [0.45 0.35 0.32 0.30]
  [0.42 0.35 0.35 0.30]
  [0.48 0.35 0.35 0.30]
  [0.45 0.35 0.32 0.30]
  [0.48 0.38 0.35 0.32]
  [0.45 0.35 0.30 0.30]
  [0.42 0.35 0.38 0.32]
  [0.45 0.38 0.35 0.30]
  [0.48 0.38 0.30 0.30]
  [0.42 0.35 0.32 0.30]
>`;

  // ════════════════════════════════════════════════════════════
  // MELODY MOTIF SYSTEM
  // ════════════════════════════════════════════════════════════
  //
  // Same seed motif as Digging in the Markets: [0,1,2,4] = "do re mi sol"
  // Applied via .scale() — pentatonic for melody (always consonant over
  // any chord in the progression). Comp/bass provide diatonic richness;
  // melody stays in the pentatonic "safe zone" — standard jazz practice.
  //
  // Jazz phrasing: quarter-note feel with @weights for held notes.
  // 8-bar phrases via <> cycling. Bars 1 & 8 = core motif anchor.
  // Bars 2-7 = variations. "Depart and return."
  //
  // 3 magnitude bands × 2 directions = 6 phrase sets. Bands match
  // Weather Vane: 0.5–2¢ LOW, 2–5¢ MED, ≥5¢ HIGH. No "flat" set —
  // melody is gated silent when price isn't moving.

  // ── Rising phrases (price ticking up) ──

  // Low magnitude — sparse, held notes, jazz ballad feel
  const MOTIF_RISE_LOW = `<
    [0@2 1 2]
    [~@2 2 ~]
    [1@2 2 3]
    [~@2 ~ ~]
    [0@2 1 ~]
    [~@2 2 1]
    [2 1 0 ~]
    [0 1 2 4]
  >`;

  // Medium magnitude — clear climb, all bars active
  const MOTIF_RISE_MED = `<
    [0 1 2 4]
    [2 1 2 ~]
    [1 2 3 5]
    [3 2 1 2]
    [0 1 2 ~]
    [1 3 2 4]
    [4 2 1 ~]
    [0 1 2 4]
  >`;

  // High magnitude — sweeping sequence, relentless
  const MOTIF_RISE_HIGH = `<
    [0 1 2 4]
    [1 2 3 5]
    [2 3 4 6]
    [4 3 4 5]
    [3 4 5 7]
    [5 4 5 6]
    [6 4 2 ~]
    [0 1 2 4]
  >`;

  // ── Falling phrases (price ticking down) ──

  // Low magnitude — sparse, tentative descent
  const MOTIF_FALL_LOW = `<
    [4@2 3 2]
    [~@2 2 ~]
    [3@2 2 1]
    [~@2 ~ ~]
    [4@2 3 ~]
    [~@2 1 2]
    [1 2 3 ~]
    [4 2 1 0]
  >`;

  // Medium magnitude — clear descent with development
  const MOTIF_FALL_MED = `<
    [4 2 1 0]
    [1 2 1 ~]
    [3 1 0 1]
    [0 1 2 1]
    [4 3 2 ~]
    [3 1 2 0]
    [0 1 2 ~]
    [4 2 1 0]
  >`;

  // High magnitude — sweeping descent
  const MOTIF_FALL_HIGH = `<
    [7 5 4 2]
    [6 4 3 1]
    [5 3 2 0]
    [2 3 2 1]
    [4 2 1 0]
    [1 2 1 0]
    [0 2 3 ~]
    [4 2 1 0]
  >`;

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // ════════════════════════════════════════════════════════════

  // Comp — rhythmic piano stabs
  function compCode(intBand, energy, volatility, gainMul) {
    let struct, vel, velMax;
    if (intBand === 0) {
      // Very sparse: hits on only 2 of 8 bars
      struct = `<
    [~ [~@2 x] ~ ~]
    [~ ~ ~ ~]
    [~ ~ ~ ~]
    [~ ~ ~ ~]
    [~ ~ ~ [~@2 x]]
    [~ ~ ~ ~]
    [~ ~ ~ ~]
    [~ ~ ~ ~]
  >`;
      vel = (0.15 * energy * gainMul).toFixed(3);
      velMax = (0.25 * energy * gainMul).toFixed(3);
    } else if (intBand === 1) {
      // Mid: syncopated on alternate bars
      struct = `<
    [~ [~@2 x] ~ [~@2 x]]
    [~ ~ ~ ~]
    [~ x ~ [~@2 x]]
    [~ ~ ~ ~]
    [~ [~@2 x] [~@2 x] ~]
    [~ ~ ~ ~]
    [[~@2 x] ~ ~ [~@2 x]]
    [~ ~ ~ ~]
  >`;
      vel = (0.20 * energy * gainMul).toFixed(3);
      velMax = (0.35 * energy * gainMul).toFixed(3);
    } else {
      // High: dense every bar
      struct = `<
    [~ [~@2 x] ~ [~@2 x]]
    [[~@2 x] ~ ~ x]
    [~ x ~ [~@2 x]]
    [~ ~ [~@2 x] ~]
    [~ [~@2 x] [~@2 x] ~]
    [~ x ~ [~@2 x]]
    [[~@2 x] ~ ~ [~@2 x]]
    [~ [~@2 x] ~ x]
  >`;
      vel = (0.25 * energy * gainMul).toFixed(3);
      velMax = (0.45 * energy * gainMul).toFixed(3);
    }
    const delayFb = (0.20 + volatility * 0.20).toFixed(2);
    return `
$: chord(changes)
  .dict("ireal")
  .voicing()
  .struct(\`${struct}\`)
  .s("piano")
  .clip(1)
  .velocity(rand.range(${vel}, ${velMax}))
  .room(0.25)
  .roomsize(3)
  .delay(0.12)
  .delaytime(0.18)
  .delayfeedback(${delayFb})
  .orbit(1);
`;
  }

  // Bass — walking bass following momentum direction
  function bassCode(bassNotes, energy, volatility, gainMul) {
    const gains = scaleGains(BASS_GAINS, energy * gainMul);
    const lpf = Math.round(900 - volatility * 350);
    return `
$: note(\`${bassNotes}\`)
  .s("gm_acoustic_bass")
  .clip(1)
  .gain(\`${gains}\`)
  .lpf(${lpf})
  .hpf(60)
  .room(0.08)
  .orbit(3);
`;
  }

  // Melody — motif-based piano melody via .scale()
  // Always Bb pentatonic — direction (ascending/descending) conveys market
  // mood, not mode changes. Comp/bass handle harmonic shifts underneath.
  // Direction + magnitude come from server-decided price_delta_band
  // (sensitivity-scaled). Raw cents still shapes the velocity and gain
  // curves so loudness within a band scales with the actual move.
  function melodyCode(tone, band, dCents, intBand, volatility, gainMul) {
    const scale = "Bb4:pentatonic";
    const mag = Math.abs(band);
    const dir = band > 0 ? 1 : -1;

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

    // Cents saturation drives velocity range and overall gain — same
    // shape as Weather Vane: ramp up to 10¢ raw move at saturation.
    const sat = Math.min(1.0, Math.abs(dCents) / 10.0);
    const vel = (0.30 + sat * 0.30).toFixed(3);
    const velMax = (0.40 + sat * 0.20).toFixed(3);
    const delayFb = (0.15 + volatility * 0.25).toFixed(2);
    const g = ((0.30 + sat * 0.30) * gainMul).toFixed(3);

    // Intensity embellishment: high intBand adds occasional octave reinforcement
    // Pentatonic octave = 5 degrees
    const embellish = intBand >= 2
      ? (dir < 0
          ? `.rarely(x => x.add(note(-5)))`
          : `.rarely(x => x.add(note(5)))`)
      : '';

    return `
$: note(\`${melodyPattern}\`).scale("${scale}")
  .s("piano")
  .velocity(rand.range(${vel}, ${velMax}))${embellish}
  .gain(${g})
  .room(0.25)
  .roomsize(3)
  .delay(0.08)
  .delaytime(0.18)
  .delayfeedback(${delayFb})
  .orbit(2);
`;
  }

  // Ride cymbal
  function rideCode(energy, gainMul) {
    const gains = scaleGains(
      "0.25 [0.28 0.12] 0.3 [0.32 0.12]",
      energy * gainMul,
    );
    return `
$: s("rd [rd@2 rd] rd [rd@2 rd]")
  .gain("${gains}")
  .orbit(4);
`;
  }

  // Hi-hat — complexity scales with intBand
  function hihatCode(intBand, energy, gainMul) {
    if (intBand === 0) {
      const g = (0.25 * energy * gainMul).toFixed(3);
      return `
$: s("[~ hh ~ hh]")
  .gain(${g})
  .cut(1)
  .orbit(4);
`;
    }
    const gains = scaleGains(
      `<
      [~ 0.30 ~ 0.24]
      [0.10 0.30 0.10 0.24]
      [~ 0.30 ~ [0.24 [~ 0.14]]]
      [~ 0.28 ~ 0.24]
      [~ 0.30 ~ 0.34]
      [0.12 0.32 0.12 [0.26 [~ 0.14]]]
      [~ 0.28 ~ 0.24]
      [~ 0.30 [~ 0.34] 0.24]
    >`,
      energy * gainMul,
    );
    return `
$: s(\`<
  [~ hh ~ hh]
  [hh hh hh hh]
  [~ hh ~ [hh [~@2 hh]]]
  [~ hh ~ hh]
  [~ hh ~ oh]
  [hh hh hh [hh [~@2 hh]]]
  [~ hh ~ hh]
  [~ hh [~@2 oh] hh]
>\`)
  .gain(\`${gains}\`)
  .cut(1)
  .orbit(4);
`;
  }

  // Ghost snare
  function ghostSnareCode(intBand, energy, gainMul) {
    const dropout = intBand >= 2 ? 0.25 : 0.50;
    const gMin = (0.05 * energy * gainMul).toFixed(3);
    const gMax = (0.09 * energy * gainMul).toFixed(3);
    return `
$: s("[~@2 sd] ~ [~@2 sd] ~")
  .gain(rand.range(${gMin}, ${gMax}))
  .sometimesBy(${dropout}, (x) => x.gain(0))
  .orbit(4);
`;
  }

  // Cross-stick
  function crossStickCode(energy, gainMul) {
    return `
$: s("~ ~ ~ rim").degradeBy(0.5).gain(${(0.29 * energy * gainMul).toFixed(3)}).orbit(4);
`;
  }

  // Kick bombs
  function kickCode(energy, gainMul) {
    const g = (0.18 * energy * gainMul).toFixed(3);
    return `
$: s(\`<
  [bd ~ ~ ~]
  [bd ~ [~@2 bd] ~]
  [bd ~ ~ ~]
  [~ ~ bd ~]
  [bd ~ ~ [~@2 bd]]
  [bd ~ [~@2 bd] ~]
  [bd ~ ~ ~]
  [~ ~ ~ ~]
>\`)
  .gain(${g})
  .orbit(4);
`;
  }

  // Turnaround fill
  function fillCode(energy, gainMul) {
    return `
$: s("<~ ~ ~ ~ ~ ~ ~ [~ ~ [sd ~] [~ ~ sd]]>").gain(${(0.22 * energy * gainMul).toFixed(3)}).room(0.15).orbit(4);
`;
  }

  // ── Track object ──

  return {
    name: "late_night_in_bb",
    label: "Late Night in Bb",
    category: "music",
    cpm: 30,

    voices: {
      comp:       { label: "Comping",     default: 1.0 },
      bass:       { label: "Bass",        default: 1.0 },
      melody:     { label: "Melody",      default: 1.0, meter: 'delta' },
      ride:       { label: "Ride",        default: 1.0 },
      hihat:      { label: "Hi-hat",      default: 1.0 },
      ghostSnare: { label: "Ghost Snare", default: 1.0 },
      crossStick: { label: "Cross-stick", default: 1.0 },
      kick:       { label: "Kick",        default: 1.0 },
      fill:       { label: "Fill",        default: 1.0 },
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
      const h = data.heat || 0;
      const tone = data.tone !== undefined ? data.tone : 1;
      const tradeRate = data.trade_rate || 0;
      const vel = data.velocity || 0;
      const momentum = data.momentum || 0;
      const volatility = data.volatility || 0;
      const dCents = data.price_delta_cents || 0;
      const serverBand = data.price_delta_band ?? 0;  // -3..+3, server-decided
      const moving = data.price_moving === true;

      // Quantize for cache stability
      const hQ = q(h, 0.05);
      const volQ = q(volatility, 0.1);
      const momQ = q(momentum, 0.1);
      const momMagQ = Math.abs(momQ);

      // Direction from momentum sign — drives bass walk + chord cycling.
      // Bass intentionally leans on the longer-term trend; melody uses
      // the per-tick cents delta below.
      const momDir = momMagQ < 0.1 ? 'flat' : (momQ > 0 ? 'up' : 'down');

      // Intensity band from trading activity (drives rhythmic complexity)
      const rawIntensity = 0.6 * tradeRate + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;

      // Momentum band (drives bass melodic range — bigger trend = wider walk)
      const momBand = momMagQ < 0.25 ? 0 : momMagQ < 0.55 ? 1 : 2;

      // Bass melodic band: max of rhythm and momentum
      // Strong trends get wide intervals even with moderate trading
      const melodicBand = Math.max(intBand, momBand);

      // Melody gate: same two-signal rule as Weather Vane.
      // serverBand is 0 inside the deadzone, acting as the magnitude
      // gate; price_moving handles "is the price ticking right now".
      const melodyBand = moving ? serverBand : 0;
      const melodyOn = melodyBand !== 0;

      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      // Quantize cents to 0.5¢ for the gain saturation curve cache.
      const centsKey = Math.round(dCents * 2) / 2;
      const melodyKey = melodyOn ? `${melodyBand}@${centsKey}` : 'off';
      const key = `${tone}:${intBand}:${melodicBand}:${hQ}:${momDir}:${melodyKey}:${volQ}:${gainKey}`;

      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // Energy = heat directly, no floor. At heat 0, everything is silent.
      const energy = hQ;
      const changes = tone === 1 ? BULLISH_CHANGES : BEARISH_CHANGES;

      // Select bass pattern: tone → key, momDir → direction, melodicBand → range
      const bassPatterns = tone === 1
        ? (momDir === 'up' ? BB_BASS_UP : momDir === 'down' ? BB_BASS_DOWN : BB_BASS_FLAT)
        : (momDir === 'up' ? GM_BASS_UP : momDir === 'down' ? GM_BASS_DOWN : GM_BASS_FLAT);
      const bassNotes = bassPatterns[melodicBand];

      // ── Build code ──
      let code = "setcpm(30);\n";
      code += `let changes = "${changes}";\n`;

      // 1. Comp — rhythmic piano stabs (heat > 0.20)
      code += hQ > 0.20
        ? compCode(intBand, energy, volQ, this.getGain('comp'))
        : '\n$: silence;\n';

      // 3. Bass — walking bass (heat > 0.15)
      code += hQ > 0.15
        ? bassCode(bassNotes, energy, volQ, this.getGain('bass'))
        : '\n$: silence;\n';

      // 4. Ride cymbal (heat > 0.20)
      code += hQ > 0.20
        ? rideCode(energy, this.getGain('ride'))
        : '\n$: silence;\n';

      // 5. Hi-hat (heat > 0.30)
      code += hQ > 0.30
        ? hihatCode(intBand, energy, this.getGain('hihat'))
        : '\n$: silence;\n';

      // 6. Melody — fires only when price is actually ticking and the
      // server-decided band is non-zero. Direction + magnitude come from
      // price_delta_band; raw cents shapes the gain-saturation curve.
      // Heat/momentum no longer gate it (the rest of the band conveys
      // trading activity).
      code += melodyOn
        ? melodyCode(tone, melodyBand, dCents, intBand, volQ, this.getGain('melody'))
        : '\n$: silence;\n';

      // 7. Ghost snare (intBand >= 1 AND heat > 0.40)
      code += (intBand >= 1 && hQ > 0.40)
        ? ghostSnareCode(intBand, energy, this.getGain('ghostSnare'))
        : '\n$: silence;\n';

      // 8. Cross-stick (intBand >= 1 AND heat > 0.40)
      code += (intBand >= 1 && hQ > 0.40)
        ? crossStickCode(energy, this.getGain('crossStick'))
        : '\n$: silence;\n';

      // 9. Kick bombs (intBand >= 2 AND heat > 0.55)
      code += (intBand >= 2 && hQ > 0.55)
        ? kickCode(energy, this.getGain('kick'))
        : '\n$: silence;\n';

      // 10. Turnaround fill (intBand >= 2 AND heat > 0.60)
      code += (intBand >= 2 && hQ > 0.60)
        ? fillCode(energy, this.getGain('fill'))
        : '\n$: silence;\n';

      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        const gain = (0.04 + (msg.magnitude || 0.5) * 0.04).toFixed(3);
        return `$: s("<cr:0 ~ ~ ~>").gain(${gain}).room(0.4).orbit(5);`;
      }
      if (type === "price_step") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const scale = "Bb4:pentatonic";
        // Seed motif — same shape as continuous melody, reinforces identity
        const run = dir > 0 ? "[0 1 2 4]" : "[4 2 1 0]";
        return `$: note("${run}").scale("${scale}").s("piano").clip(0.5).velocity(${(0.3 + mag * 0.3).toFixed(2)}).gain(${gain}).room(0.35).delay(0.15).delayfeedback(0.25).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("late_night_in_bb", jazzTrioTrack);
