// ── Late Night in Bb — Jazz Piano Trio ───────────────────
// Two tonalities: bullish (Bb major) / bearish (G minor).
// Tone selects major/minor quality; momentum drives ascending/descending contour.
// Heat controls layer density — a dead market converges to silence.
// Trade rate + velocity drive rhythmic complexity (intBand).
// Momentum magnitude drives melodic range (melodicBand).
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
  // MELODY PATTERNS — same structure as bass
  // Direction from momentum, range from melodicBand
  // ════════════════════════════════════════════════════════════

  // Bb major — ascending melody
  const BB_MELODY_UP = [
    // intBand 0: sparse ascending hints
    `<
  [C5@2 D5 ~]
  [A4@3 ~]
  [Bb4 ~ D5@2]
  [Eb5@2 G4@2]
  [C5@2 Eb5 ~]
  [A4 ~ C5@2]
  [D5@2 Bb4@2]
  [Bb4@2 C5@2]
>`,
    // intBand 1: quarter-note ascending climbs
    `<
  [Bb4 C5 D5 Eb5]
  [A4 C5 Eb5 ~]
  [Bb4 ~ D5 F5]
  [Eb4 G4 Bb4 ~]
  [C5 D5 Eb5 G5]
  [F4 A4 C5 Eb5]
  [Bb4 D5 F5 ~]
  [Bb4 C5 D5 F5]
>`,
    // intBand 2: eighth-note ascending runs
    `<
  [Bb4 C5 [Db5 D5] Eb5]
  [A4 [Bb4 C5] Eb5 ~]
  [[Bb4 C5] D5 [Eb5 F5] ~]
  [Eb4 [F4 G4] Bb4 ~]
  [C5 [D5 Eb5] G5 F5]
  [[F4 G4] A4 C5 Eb5]
  [Bb4 [C5 D5] F5 D5]
  [[Bb4 D5] [C5 Eb5] F5 D5]
>`,
  ];

  // Bb major — descending melody
  const BB_MELODY_DOWN = [
    // intBand 0: sparse descending
    `<
  [G5@2 Eb5 ~]
  [C5@2 A4@2]
  [F5@2 D5 ~]
  [Bb4@2 ~ G4]
  [Eb5@2 C5 ~]
  [A4@2 F4@2]
  [D5@2 Bb4@2]
  [Bb4@2 A4@2]
>`,
    // intBand 1: quarter-note descending phrases
    `<
  [G5 Eb5 C5 Bb4]
  [C5 A4 F4 ~]
  [F5 D5 Bb4 A4]
  [Bb4 G4 Eb4 ~]
  [Eb5 C5 Bb4 G4]
  [A4 F4 Eb4 C4]
  [D5 Bb4 A4 F4]
  [Bb4 A4 G4 F4]
>`,
    // intBand 2: eighth-note descending runs
    `<
  [G5 [F5 Eb5] C5 Bb4]
  [[C5 Bb4] A4 F4 ~]
  [F5 [Eb5 D5] Bb4 A4]
  [[Bb4 Ab4] G4 Eb4 D4]
  [Eb5 [D5 C5] Bb4 G4]
  [[A4 G4] F4 Eb4 C4]
  [D5 [C5 Bb4] A4 F4]
  [[Bb4 A4] [G4 F4] Eb4 D4]
>`,
  ];

  // Bb major — flat melody (meandering, no clear direction)
  const BB_MELODY_FLAT = [
    `<[Bb4@2 ~ ~] [A4@3 ~] [D5@2 Bb4@2] [G4@3 ~] [C5@2 ~ ~] [~ A4@2 ~] [Bb4@3 ~] [Bb4@2 ~ ~]>`,
    `<[C5 ~ Bb4 ~] [A4 ~ C5 ~] [D5 ~ Bb4 ~] [Eb5 ~ G4 ~] [C5 ~ Eb5 ~] [A4 ~ F4 ~] [Bb4 ~ D5 ~] [Bb4 ~ A4 ~]>`,
    `<[[C5|Eb5] ~ [D5|Bb4] ~] [A4 [C5|Bb4] ~ ~] [[Bb4|D5] ~ [F5|Bb4] ~] [[Eb5|G4] ~ ~ ~] [[C5|Bb4] ~ [Eb5|D5] ~] [~ [A4|C5] ~ ~] [[D5|Bb4] ~ [C5|A4] ~] [[Bb4|D5] ~ ~ ~]>`,
  ];

  // G minor — ascending melody
  const GM_MELODY_UP = [
    // intBand 0: sparse ascending
    `<
  [A4@2 C5 ~]
  [D4@2 F#4@2]
  [G4 ~ Bb4@2]
  [C4@2 Eb4@2]
  [A4@2 Eb5 ~]
  [D4 ~ F#4@2]
  [G4@2 Bb4@2]
  [Bb4@2 D5@2]
>`,
    // intBand 1: quarter-note ascending phrases
    `<
  [A4 C5 Eb5 G5]
  [D4 F#4 A4 ~]
  [G4 Bb4 D5 F5]
  [C4 Eb4 G4 Bb4]
  [A4 Eb5 G5 A5]
  [F#4 A4 C5 D5]
  [G4 Bb4 D5 ~]
  [Bb4 C5 D5 G5]
>`,
    // intBand 2: eighth-note ascending runs
    `<
  [A4 [Bb4 C5] Eb5 G5]
  [D4 [Eb4 F#4] A4 ~]
  [[G4 A4] Bb4 [C5 D5] F5]
  [C4 [D4 Eb4] G4 Bb4]
  [A4 [C5 Eb5] G5 [F5 A5]]
  [[F#4 G4] A4 C5 [D5 Eb5]]
  [G4 [A4 Bb4] [C5 D5] F5]
  [[Bb4 C5] [D5 Eb5] F5 G5]
>`,
  ];

  // G minor — descending melody
  const GM_MELODY_DOWN = [
    // intBand 0: sparse descending
    `<
  [G5@2 Eb5 ~]
  [F#4@3 ~]
  [D5@2 Bb4@2]
  [C5@2 ~ G4]
  [Eb5@2 C5 ~]
  [A4@2 F#4@2]
  [Bb4@3 ~]
  [D5@2 Bb4@2]
>`,
    // intBand 1: quarter-note descending phrases
    `<
  [G5 Eb5 C5 A4]
  [C5 A4 F#4 ~]
  [D5 Bb4 G4 ~]
  [C5 Bb4 G4 Eb4]
  [Eb5 C5 A4 G4]
  [A4 F#4 D4@2]
  [Bb4 A4 G4 F4]
  [D5 Bb4 A4 G4]
>`,
    // intBand 2: eighth-note descending runs
    `<
  [G5 [F5 Eb5] C5 A4]
  [[C5 Bb4] A4 F#4 ~]
  [D5 [C5 Bb4] G4 F4]
  [C5 [Bb4 Ab4] G4 Eb4]
  [[Eb5 Db5] C5 [Bb4 A4] G4]
  [A4 [Ab4 F#4] D4 ~]
  [[Bb4 A4] G4 [F4 Eb4] D4]
  [D5 [C5 Bb4] [A4 G4] F4]
>`,
  ];

  // G minor — flat melody (meandering)
  const GM_MELODY_FLAT = [
    `<[G4@2 ~ A4] [F#4@3 ~] [Bb4@2 G4@2] [C5@3 ~] [A4@2 G4@2] [~ F#4@2 ~] [G4@3 ~] [G4@2 ~ ~]>`,
    `<[G4 ~ A4 ~] [F#4 ~ D4 ~] [G4 ~ Bb4 ~] [C5 ~ G4 ~] [A4 ~ Eb4 ~] [F#4 ~ A4 ~] [G4 ~ D5 ~] [Bb4 ~ G4 ~]>`,
    `<[[G4|Bb4] ~ [A4|G4] ~] [F#4 [A4|D4] ~ ~] [[G4|Bb4] ~ [D5|G4] ~] [[C5|Eb4] ~ ~ ~] [[A4|G4] ~ [Eb5|C5] ~] [~ [F#4|A4] ~ ~] [[Bb4|G4] ~ [A4|F4] ~] [[G4|Bb4] ~ ~ ~]>`,
  ];

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // ════════════════════════════════════════════════════════════

  // Pad — sustained ambient chords (first layer to appear)
  function padCode(energy, volatility, gainMul) {
    const g = (0.12 * energy * gainMul).toFixed(3);
    const room = (0.35 + volatility * 0.3).toFixed(2);
    return `
$: chord(changes)
  .dict("ireal")
  .voicing()
  .s("triangle")
  .attack(0.8)
  .release(3)
  .sustain(0.5)
  .gain(${g})
  .lpf(${Math.round(800 + energy * 600)})
  .room(${room})
  .roomsize(5)
  .orbit(1);
`;
  }

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
    // Volatility wobbles the piano — slight speed variation (detuning)
    const spdLo = (1.0 - volatility * 0.03).toFixed(3);
    const spdHi = (1.0 + volatility * 0.03).toFixed(3);
    const delayFb = (0.20 + volatility * 0.20).toFixed(2);
    return `
$: chord(changes)
  .dict("ireal")
  .voicing()
  .struct(\`${struct}\`)
  .s("piano")
  .clip(1)
  .velocity(rand.range(${vel}, ${velMax}))
  .speed(rand.range(${spdLo}, ${spdHi}))
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
  .speed(rand.range(0.98, 1.02))
  .orbit(3);
`;
  }

  // Melody — piano melody following momentum direction
  function melodyCode(melodyNotes, melodyStrength, energy, volatility, gainMul) {
    const vel = (0.30 + melodyStrength * 0.30).toFixed(3);
    const velMax = (0.40 + melodyStrength * 0.20).toFixed(3);
    const delayFb = (0.15 + volatility * 0.25).toFixed(2);
    return `
$: note(\`${melodyNotes}\`)
  .s("piano")
  .clip(1)
  .velocity(rand.range(${vel}, ${velMax}))
  .gain(${(energy * gainMul).toFixed(3)})
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
    name: "jazz_trio",
    label: "Late Night in Bb",
    category: "music",
    cpm: 30,

    voices: {
      pad:        { label: "Pad",         default: 1.0 },
      comp:       { label: "Comping",     default: 1.0 },
      bass:       { label: "Bass",        default: 1.0 },
      melody:     { label: "Melody",      default: 1.0 },
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
      const momMag = Math.abs(momentum);
      const volatility = data.volatility || 0;
      const pm = data.price_move || 0;
      const pmAbs = Math.abs(pm);

      // Quantize for cache stability
      const hQ = q(h, 0.05);
      const volQ = q(volatility, 0.1);
      const momQ = q(momentum, 0.1);
      const momMagQ = Math.abs(momQ);

      // Direction from momentum sign
      const momDir = momMagQ < 0.1 ? 'flat' : (momQ > 0 ? 'up' : 'down');

      // Intensity band from trading activity (drives rhythmic complexity)
      const rawIntensity = 0.6 * tradeRate + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;

      // Momentum band (drives melodic range — bigger move = wider intervals)
      const momBand = momMagQ < 0.25 ? 0 : momMagQ < 0.55 ? 1 : 2;

      // Melodic band: max of rhythm and momentum
      // Strong trends get wide intervals even with moderate trading
      const melodicBand = Math.max(intBand, momBand);

      // Melody strength: whichever is stronger — edge-detected move or sustained momentum
      const melodyStrength = Math.max(pmAbs, momMag * 0.7);
      const msQ = q(melodyStrength, 0.1);

      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${tone}:${intBand}:${melodicBand}:${hQ}:${momDir}:${msQ}:${volQ}:${gainKey}`;

      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // Energy = heat directly, no floor. At heat 0, everything is silent.
      const energy = hQ;
      const changes = tone === 1 ? BULLISH_CHANGES : BEARISH_CHANGES;

      // Select bass pattern: tone → key, momDir → direction, melodicBand → range
      const bassPatterns = tone === 1
        ? (momDir === 'up' ? BB_BASS_UP : momDir === 'down' ? BB_BASS_DOWN : BB_BASS_FLAT)
        : (momDir === 'up' ? GM_BASS_UP : momDir === 'down' ? GM_BASS_DOWN : GM_BASS_FLAT);
      const bassNotes = bassPatterns[melodicBand];

      // Select melody pattern: same axes
      const melodyPatterns = tone === 1
        ? (momDir === 'up' ? BB_MELODY_UP : momDir === 'down' ? BB_MELODY_DOWN : BB_MELODY_FLAT)
        : (momDir === 'up' ? GM_MELODY_UP : momDir === 'down' ? GM_MELODY_DOWN : GM_MELODY_FLAT);
      const melodyNotes = melodyPatterns[melodicBand];

      // ── Build code ──
      let code = "setcpm(30);\n";
      code += `let changes = "${changes}";\n`;

      // 1. Pad — sustained ambient chords (heat > 0.05)
      code += hQ > 0.05
        ? padCode(energy, volQ, this.getGain('pad'))
        : '\n$: silence;\n';

      // 2. Comp — rhythmic piano stabs (heat > 0.20)
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

      // 6. Melody — during trends or active movement (heat > 0.20 AND melodyStrength > 0.05)
      code += (hQ > 0.20 && melodyStrength > 0.05)
        ? melodyCode(melodyNotes, melodyStrength, energy, volQ, this.getGain('melody'))
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
      if (type === "price_move") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const run = tone === 1
          ? (dir > 0 ? "[Bb4 C5 D5 F5]" : "[F5 D5 C5 Bb4]")
          : (dir > 0 ? "[G4 Bb4 D5 F5]" : "[F5 D5 Bb4 G4]");
        return `$: note("${run}").s("piano").clip(0.5).velocity(${(0.3 + mag * 0.3).toFixed(2)}).gain(${gain}).room(0.35).delay(0.15).delayfeedback(0.25).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("jazz_trio", jazzTrioTrack);
