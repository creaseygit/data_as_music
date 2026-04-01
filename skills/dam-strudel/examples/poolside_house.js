// ── Poolside House ─────────────────────────────────────
// Relaxed daytime house music (~116 BPM). Rhodes chords, bouncy bass,
// organic percussion, and plucked synth melodies that follow momentum.
// Heat controls layer density; momentum drives melodic/harmonic direction.
// category: 'music', label: 'Poolside House'
//
// ── DATA SIGNALS ──
// heat        0.0–1.0   Overall market activity — controls layer density
// price       0.0–1.0   Current price — drives filter cutoff base
// price_move -1.0–1.0   Active price change (edge-detected, 30s window)
// momentum   -1.0–1.0   Sustained trend direction — drives melodic contour
// velocity    0.0–1.0   Price velocity magnitude — part of intensity band
// trade_rate  0.0–1.0   Trades per minute — part of intensity band
// spread      0.0–1.0   Bid-ask spread (normalized)
// volatility  0.0–1.0   Price oscillation — drives reverb & fragmentation
// tone        0 or 1    1=major (bullish), 0=minor (bearish)
// sensitivity 0.0–1.0   Client sensitivity setting

const poolsideHouse = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  // ── Quantize helper (reduces pattern rebuilds) ──
  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // One function per voice. Each returns a Strudel code string
  // starting with `$:`. Each receives a gain multiplier from
  // getGain() for mastering page support.
  // ════════════════════════════════════════════════════════════

  // ── Kick ──
  function kickCode(energy, gainMul) {
    const g = (0.35 * energy * gainMul).toFixed(3);
    return `$: s("bd bd bd bd").gain(${g})`
      // Subtle velocity humanization — not robotic
      + `.gain(perlin.range(${(0.3 * energy * gainMul).toFixed(3)}, ${g}))`
      + `.lpf(100).orbit(4);\n`;
  }

  // ── Rhodes / EP chords ──
  function chordsCode(tone, momSign, intBand, energy, filterBase, reverbWet, roomSize, gainMul) {
    let changes;
    if (tone === 1) {
      if (momSign > 0)      changes = "<C^7 Dm9 Em7 F^7>";
      else if (momSign < 0) changes = "<C^7 Bb^7 Am9 G7>";
      else                  changes = "<C^7 Am9 Dm9 G7>";
    } else {
      if (momSign > 0)      changes = "<Am7 Bm7b5 Cm7 Dm7>";
      else if (momSign < 0) changes = "<Am7 Gm7 Fm9 E7>";
      else                  changes = "<Am7 Fm9 Dm7 E7>";
    }
    const g = (0.25 * energy * gainMul).toFixed(3);
    // Comping rhythm varies by intensity — sparse at low, busier at high
    const struct = intBand >= 2
      ? "~ [~@2 x] [~ x] [~@2 x]"   // more stabs at high intensity
      : "~ [~@2 x] ~ [~@2 x]";       // classic offbeat at low/mid
    return `$: chord("${changes}").dict("ireal").voicing()`
      + `.struct("${struct}")`
      + `.s("gm_epiano1").gain(${g})`
      // Every 5 cycles, double the stab for rhythmic surprise
      + `.every(5, x => x.ply(2))`
      + `.room(${reverbWet}).rsize(${roomSize})`
      + `.lpf(${Math.round(filterBase)})`
      + `.pan(0.4).orbit(1);\n`;
  }

  // ── Bouncy bassline ──
  function bassCode(tone, momSign, intBand, energy, h, gainMul) {
    const g = (0.3 * energy * gainMul).toFixed(3);
    const bassLpf = Math.round(300 + h * 400);
    let bassPattern;
    if (tone === 1) {
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[C2 D2 E2 F2] [A2 B2 C3 D3] [D2 E2 F2 G2] [G2 A2 B2 C3]>";
        else if (momSign < 0) bassPattern = "<[C3 B2 A2 G2] [A2 G2 F2 E2] [D3 C3 B2 A2] [G2 F2 E2 D2]>";
        else                  bassPattern = "<[C2 ~ E2 ~] [A2 ~ C3 A2] [D2 ~ F2 ~] [G2 ~ B2 G2]>";
      } else {
        if (momSign > 0)      bassPattern = "<C2 D2 E2 F2>";
        else if (momSign < 0) bassPattern = "<C3 B2 A2 G2>";
        else                  bassPattern = "<C2 A2 D2 G2>";
      }
    } else {
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[A1 B1 C2 D2] [F2 G2 A2 B2] [D2 E2 F2 G2] [E2 F2 G#2 A2]>";
        else if (momSign < 0) bassPattern = "<[A2 G2 F2 E2] [F2 E2 D2 C2] [D2 C2 B1 A1] [E2 D2 C2 B1]>";
        else                  bassPattern = "<[A1 ~ C2 ~] [F2 ~ A2 F2] [D2 ~ F2 ~] [E2 ~ G#2 E2]>";
      } else {
        if (momSign > 0)      bassPattern = "<A1 B1 C2 D2>";
        else if (momSign < 0) bassPattern = "<A2 G2 F2 E2>";
        else                  bassPattern = "<A1 F2 D2 E2>";
      }
    }
    return `$: note("${bassPattern}").s("sawtooth")`
      + `.lpf(${bassLpf}).lpq(3).decay(0.3).sustain(0)`
      + `.gain(${g}).orbit(3);\n`;
  }

  // ── Percussion (returns 3 $: blocks) ──
  function percCode(intBand, energy, reverbWet, gainMul) {
    const gLo = (0.1 * energy * gainMul).toFixed(3);
    const gHi = (0.25 * energy * gainMul).toFixed(3);
    let code = '';

    if (intBand === 0) {
      code += `$: s("hh*8").gain(perlin.range(${gLo}, ${gHi})).hpf(9000)`
        + `.iter(4).pan(0.6).orbit(4);\n`;
      code += `$: silence;\n`;
      code += `$: silence;\n`;
    } else if (intBand === 1) {
      code += `$: s("hh*8").gain(perlin.range(${gLo}, ${gHi})).hpf(9000)`
        + `.sometimes(x => x.gain(${(0.35 * energy * gainMul).toFixed(3)}))`
        + `.iter(4).pan(0.6).orbit(4);\n`;
      code += `$: s("~ cp ~ cp").gain(${(0.2 * energy * gainMul).toFixed(3)}).room(${reverbWet}).pan(0.55).orbit(4);\n`;
      code += `$: s("oh").struct("~ x ~ ~").degradeBy(0.3).gain(${(0.1 * energy * gainMul).toFixed(3)}).hpf(7000).pan(0.65).orbit(4);\n`;
    } else {
      code += `$: s("hh*16").gain(perlin.range(${gLo}, ${gHi})).hpf(9000)`
        + `.sometimes(x => x.gain(${(0.35 * energy * gainMul).toFixed(3)}))`
        + `.rarely(x => x.ply(2))`
        + `.every(4, x => x.struct("x(5,8)"))`
        + `.pan(0.6).orbit(4);\n`;
      code += `$: s("~ cp ~ cp").gain(${(0.2 * energy * gainMul).toFixed(3)})`
        + `.every(7, x => x.ply(2))`
        + `.room(${reverbWet}).pan(0.55).orbit(4);\n`;
      code += `$: s("rim").struct("x(3,8)").gain(${(0.12 * energy * gainMul).toFixed(3)})`
        + `.iter(3).room(0.3).pan(0.7).orbit(4);\n`;
    }
    return code;
  }

  // ── Plucked synth melody ──
  function melodyCode(tone, momSign, intBand, energy, degradeAmt, reverbWet, roomSize, gainMul) {
    const g = (0.18 * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "C4:major" : "A4:minor";

    let melodyPattern;
    if (momSign > 0) {
      melodyPattern = intBand >= 2
        ? "[0 2 4 6] [2 4 6 7] [4 6 7 9] [6 7 9 11]"
        : "[0 ~ 2 ~] [4 ~ 6 ~] [7 ~ 9 ~] [6 ~ 7 ~]";
    } else if (momSign < 0) {
      melodyPattern = intBand >= 2
        ? "[11 9 7 6] [9 7 6 4] [7 6 4 2] [6 4 2 0]"
        : "[7 ~ 6 ~] [6 ~ 4 ~] [4 ~ 2 ~] [2 ~ 0 ~]";
    } else {
      melodyPattern = intBand >= 2
        ? "[0|2] [2|4] [4|6] [~|7] [7|4] [~|6] [2|4] [0|2]"
        : "[0|2] ~ [4|6] ~ [7|4] ~ [2|0] ~";
    }

    return `$: note("${melodyPattern}").scale("${scale}")`
      + `.iter(4).palindrome()`
      + `.degradeBy(${degradeAmt})`
      + `.rarely(x => x.add(note(7)))`
      + `.s("triangle").decay(0.15).sustain(0)`
      + `.gain(${g}).room(${reverbWet}).rsize(${roomSize})`
      + `.delay(0.25).delaytime(${(60 / 116 / 2).toFixed(4)}).delayfeedback(0.35)`
      + `.pan(0.35).orbit(2);\n`;
  }

  // ── Counter-melody ──
  function counterCode(tone, momSign, degradeAmt, energy, reverbWet, gainMul) {
    const g = (0.1 * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "C5:major" : "A5:minor";
    let counterPattern;
    if (momSign > 0)      counterPattern = "[2 ~ 4 6] [4 ~ 6 7] [6 ~ 7 9] [4 ~ 6 7]";
    else if (momSign < 0) counterPattern = "[9 ~ 7 6] [7 ~ 6 4] [6 ~ 4 2] [7 ~ 6 4]";
    else                  counterPattern = "[4|5] [~|6] [7|4] [~|2] [6|7] [~|4] [2|4] [~|0]";
    return `$: note("${counterPattern}").scale("${scale}")`
      + `.iter(4).palindrome()`
      + `.degradeBy(${(parseFloat(degradeAmt) + 0.15).toFixed(2)})`
      + `.every(3, x => x.rev())`
      + `.rarely(x => x.add(note(2)))`
      + `.s("gm_vibraphone").decay(0.2).sustain(0)`
      + `.gain(${g})`
      + `.delay(0.3).delaytime(${(60 / 116 / 3).toFixed(4)}).delayfeedback(0.4)`
      + `.room(${reverbWet})`
      + `.pan(0.65).orbit(2);\n`;
  }

  // ── Atmospheric pad ──
  function padCode(tone, momSign, energy, filterBase, reverbWet, roomSize, gainMul) {
    const g = (0.15 * energy * gainMul).toFixed(3);
    let padChanges;
    if (tone === 1) {
      if (momSign > 0)      padChanges = "<[C3,E3,G3,B3] [D3,F3,A3,C4] [E3,G3,B3,D4] [F3,A3,C4,E4]>";
      else if (momSign < 0) padChanges = "<[C4,E4,G4,B4] [Bb3,D4,F4,A4] [A3,C4,E4,G4] [G3,B3,D4,F4]>";
      else                  padChanges = "<[C3,E3,G3,B3] [A3,C4,E4,G4] [D3,F3,A3,C4] [G3,B3,D4,F4]>";
    } else {
      if (momSign > 0)      padChanges = "<[A3,C4,E4,G4] [B3,D4,F4,A4] [C4,E4,G4,B4] [D4,F4,A4,C5]>";
      else if (momSign < 0) padChanges = "<[A3,C4,E4,G4] [G3,B3,D4,F4] [F3,A3,C4,E4] [E3,G#3,B3,D4]>";
      else                  padChanges = "<[A3,C4,E4,G4] [F3,A3,C4,E4] [D3,F3,A3,C4] [E3,G#3,B3,D4]>";
    }
    return `$: note("${padChanges}").s("triangle")`
      + `.attack(0.8).release(2).sustain(0.6)`
      + `.gain(${g}).lpf(${Math.round(filterBase * 0.7)})`
      + `.room(${(parseFloat(reverbWet) + 0.15).toFixed(2)}).rsize(${(parseFloat(roomSize) + 1).toFixed(1)})`
      + `.pan(sine.range(0.3, 0.7).slow(16))`
      + `.orbit(1);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // TRACK OBJECT
  // ════════════════════════════════════════════════════════════

  return {
    name: "poolside_house",
    label: "Poolside House",
    category: "music",
    cpm: 29, // ~116 BPM — relaxed daytime house tempo

    voices: {
      kick:    { label: "Kick",    default: 1.0 },
      chords:  { label: "Chords",  default: 1.0 },
      bass:    { label: "Bass",    default: 1.0 },
      perc:    { label: "Perc",    default: 1.0 },
      melody:  { label: "Melody",  default: 1.0 },
      counter: { label: "Counter", default: 1.0 },
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
      const price = q(data.price || 0.5, 0.1);

      // ── 2. Derived values ──
      const rawIntensity = 0.6 * tr + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
      const energy = h; // raw heat IS the energy — no floor, silence is valid
      const filterBase = 600 + price * 1400;
      const reverbWet = (0.3 + volat * 0.35).toFixed(2);
      const roomSize = (2 + volat * 4).toFixed(1);
      const momSign = Math.abs(mom) < 0.15 ? 0 : (mom > 0 ? 1 : -1);
      const degradeAmt = (volat * 0.4).toFixed(2);

      // ── 3. Cache check ──
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${intBand}:${volat}:${mom}:${price}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // ── 4. Build code ──
      let code = "setcpm(29);\n\n";

      // Kick — active when heat > 0.3
      code += h > 0.3
        ? kickCode(energy, this.getGain('kick'))
        : '$: silence;\n';

      // Rhodes chords — active when heat > 0.15
      code += h > 0.15
        ? chordsCode(tone, momSign, intBand, energy, filterBase, reverbWet, roomSize, this.getGain('chords'))
        : '$: silence;\n';

      // Bass — active when heat > 0.25
      code += h > 0.25
        ? bassCode(tone, momSign, intBand, energy, h, this.getGain('bass'))
        : '$: silence;\n';

      // Percussion (3 blocks) — active when heat > 0.3
      if (h > 0.3) {
        code += percCode(intBand, energy, reverbWet, this.getGain('perc'));
      } else {
        code += '$: silence;\n$: silence;\n$: silence;\n';
      }

      // Melody — active when |momentum| > 0.2 or heat > 0.5
      code += (Math.abs(mom) > 0.2 || h > 0.5)
        ? melodyCode(tone, momSign, intBand, energy, degradeAmt, reverbWet, roomSize, this.getGain('melody'))
        : '$: silence;\n';

      // Counter-melody — active when heat > 0.6
      code += h > 0.6
        ? counterCode(tone, momSign, degradeAmt, energy, reverbWet, this.getGain('counter'))
        : '$: silence;\n';

      // Pad — active when heat > 0.1
      code += h > 0.1
        ? padCode(tone, momSign, energy, filterBase, reverbWet, roomSize, this.getGain('pad'))
        : '$: silence;\n';

      // ── 5. Cache and return ──
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        const gain = (0.02 + (msg.magnitude || 0.5) * 0.03).toFixed(3);
        return `$: s("<oh:3 ~ ~ ~>").gain(${gain}).room(0.6).rsize(4).hpf(5000).orbit(5);`;
      }
      if (type === "price_move") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.04 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const scale = tone === 1 ? "C5:major" : "A4:minor";
        const run = dir > 0
          ? "[0 2 4 6]"
          : "[6 4 2 0]";
        return `$: note("${run}").scale("${scale}").s("triangle").decay(0.12).sustain(0).gain(${gain}).room(0.4).delay(0.2).delayfeedback(0.3).orbit(5);`;
      }
      if (type === "resolved") {
        const result = msg.result || 1;
        const chord = result > 0 ? "C3,E3,G3,B3" : "A3,C4,E4,G4";
        return `$: note("${chord}").s("gm_epiano1").attack(0.5).release(4).gain(0.08).room(0.7).rsize(5).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("poolside_house", poolsideHouse);
