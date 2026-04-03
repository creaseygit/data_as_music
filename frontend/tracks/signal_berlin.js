// ── Signal Berlin ─────────────────────────────────────
// Dark, hypnotic Berlin techno at 132 BPM. Filter sweeps are the primary
// expression — volatility drives resonant LP modulation on the acid bass,
// heat controls layer density, momentum sets directional contour.
// Phrygian mode (bearish) / natural minor (bullish). Mechanical percussion,
// distorted kick, acid bassline, dark stabs with delay, evolving pad drone.
// category: 'music', label: 'Signal Berlin'
//
// ── DATA SIGNALS ──
// heat        0.0–1.0   Layer density, gain scaling, percussion stages
// price       0.0–1.0   Filter cutoff base position
// price_move -1.0–1.0   Filter sweep triggers, accent stabs
// momentum   -1.0–1.0   Bass/synth contour direction, pad voicing motion
// velocity    0.0–1.0   Part of intensity band — subdivision complexity
// trade_rate  0.0–1.0   Part of intensity band — percussion density
// spread      0.0–1.0   Reverb depth, stab interval width
// volatility  0.0–1.0   Filter modulation speed & depth — THE techno parameter
// tone        0 or 1    1=minor (bullish), 0=phrygian (bearish)

const signalBerlin = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // ════════════════════════════════════════════════════════════

  // ── Kick: progressive stages, distorted, dry ──
  function kickCode(h, intBand, energy, gainMul) {
    const g = (0.40 * energy * gainMul).toFixed(3);
    const gLo = (0.32 * energy * gainMul).toFixed(3);

    let pattern;
    let extras = '';
    if (h < 0.25) {
      pattern = "bd ~ ~ ~";                // downbeat pulse
    } else if (h < 0.40) {
      pattern = "bd ~ bd ~";               // half-time — tension building
    } else if (h < 0.60) {
      pattern = "bd bd bd bd";             // four-on-the-floor — locked in
    } else {
      pattern = "bd bd bd bd";             // full drive + occasional double
      if (intBand >= 2) {
        extras = `.every(8, x => x.ply(2))`;
      }
    }

    return `$: s("${pattern}").gain(perlin.range(${gLo}, ${g}))`
      + `.lpf(90).distort(0.3)`
      + extras
      + `.orbit(4);\n`;
  }

  // ── Hi-hat: mechanical, straight, progressive subdivision ──
  function hihatCode(h, intBand, energy, gainMul) {
    if (h < 0.20) return '$: silence;\n';

    const gLo = (0.08 * energy * gainMul).toFixed(3);
    const gHi = (0.20 * energy * gainMul).toFixed(3);
    const gAccent = (0.28 * energy * gainMul).toFixed(3);

    let code;
    if (intBand === 0) {
      // Offbeat quarters — classic techno pulse
      code = `$: s("~ hh ~ hh").gain(perlin.range(${gLo}, ${gHi}))`
        + `.hpf(8000).pan(0.55).orbit(4);\n`;
    } else if (intBand === 1) {
      // Straight 8ths — mechanical, driving
      code = `$: s("hh*8").gain(perlin.range(${gLo}, ${gHi}))`
        + `.sometimes(x => x.gain(${gAccent}))`
        + `.hpf(8000).pan(0.55).orbit(4);\n`;
    } else {
      // 16ths with accent pattern — relentless
      code = `$: s("hh*16").gain("${gLo} ${gLo} ${gHi} ${gLo}".repeat(4))`
        + `.sometimes(x => x.gain(${gAccent}))`
        + `.every(5, x => x.struct("x(7,16)"))`
        + `.hpf(8000).pan(0.55).orbit(4);\n`;
    }
    return code;
  }

  // ── Clap/snare: on 2 & 4, reverb tail, progressive ──
  function clapCode(h, intBand, energy, reverbWet, gainMul) {
    if (h < 0.30) return '$: silence;\n';

    const g = (0.18 * energy * gainMul).toFixed(3);

    if (h < 0.50) {
      // Beat 2 only — sparse
      return `$: s("~ cp ~ ~").gain(${g})`
        + `.room(${reverbWet}).rsize(3).hpf(400)`
        + `.pan(0.45).orbit(4);\n`;
    } else {
      // Beats 2 & 4 — standard
      let extras = '';
      if (intBand >= 2) {
        extras = `.every(7, x => x.ply(2))`;
      }
      return `$: s("~ cp ~ cp").gain(${g})`
        + extras
        + `.room(${reverbWet}).rsize(3).hpf(400)`
        + `.pan(0.45).orbit(4);\n`;
    }
  }

  // ── Ride/perc: metallic texture at high intensity ──
  function percCode(h, intBand, energy, gainMul) {
    if (h < 0.50) return '$: silence;\n';

    const g = (0.10 * energy * gainMul).toFixed(3);

    if (intBand < 2) {
      // Open hat on offbeats — breathing
      return `$: s("oh").struct("~ ~ ~ x").degradeBy(0.3)`
        + `.gain(${g}).hpf(6000).pan(0.65).orbit(4);\n`;
    } else {
      // Ride 16ths + rim euclidean — maximum drive
      return `$: stack(s("rd*16").gain(${(0.06 * energy * gainMul).toFixed(3)}).hpf(9000),`
        + `s("rim").struct("x(3,8)").gain(${g}).iter(3))`
        + `.pan(0.65).orbit(4);\n`;
    }
  }

  // ── Acid bass: resonant saw with filter sweep driven by volatility ──
  function bassCode(tone, momSign, intBand, h, energy, volQ, price, gainMul) {
    if (h < 0.15) return '$: silence;\n';

    const g = (0.30 * energy * gainMul).toFixed(3);

    // Filter range: price sets base, volatility sets sweep depth
    const filterBase = Math.round(150 + price * 300);
    const filterTop = Math.round(filterBase + 400 + volQ * 1800);
    // Sweep speed: volatility drives it — calm = slow, volatile = fast
    const sweepSpeed = Math.round(2 + volQ * 14);

    // Bass patterns — direction follows momentum
    let bassPattern;
    if (tone === 1) {
      // Minor: A minor
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[A1 B1 C2 D2] [C2 D2 E2 F2] [D2 E2 F2 G2] [E2 F2 G2 A2]>";
        else if (momSign < 0) bassPattern = "<[A2 G2 F2 E2] [G2 F2 E2 D2] [F2 E2 D2 C2] [E2 D2 C2 B1]>";
        else                  bassPattern = "<[A1 ~ C2 ~] [E2 ~ A1 ~] [D2 ~ F2 ~] [E2 ~ G2 E2]>";
      } else {
        if (momSign > 0)      bassPattern = "<A1 C2 D2 E2>";
        else if (momSign < 0) bassPattern = "<A2 G2 E2 D2>";
        else                  bassPattern = "<A1 E2 D2 E2>";
      }
    } else {
      // Phrygian: A phrygian — darker
      if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[A1 Bb1 C2 D2] [C2 D2 E2 F2] [D2 E2 F2 G2] [E2 F2 G2 A2]>";
        else if (momSign < 0) bassPattern = "<[A2 G2 F2 E2] [G2 F2 E2 D2] [F2 E2 D2 C2] [D2 C2 Bb1 A1]>";
        else                  bassPattern = "<[A1 ~ C2 ~] [E2 ~ A1 ~] [D2 ~ F2 ~] [E2 ~ Bb1 A1]>";
      } else {
        if (momSign > 0)      bassPattern = "<A1 C2 D2 E2>";
        else if (momSign < 0) bassPattern = "<A2 G2 E2 D2>";
        else                  bassPattern = "<A1 E2 D2 E2>";
      }
    }

    // Occasional octave jump for acid character
    return `$: note("${bassPattern}").s("sawtooth")`
      + `.lpf(sine.range(${filterBase}, ${filterTop}).slow(${sweepSpeed}))`
      + `.lpq(${(5 + volQ * 15).toFixed(1)})`
      + `.ftype("24db")`
      + `.distort(0.2).decay(0.3).sustain(0)`
      + `.rarely(x => x.add(note(12)))`
      + `.gain(${g}).orbit(3);\n`;
  }

  // ── Stab: dark minor chord hits with delay — techno signature ──
  function stabCode(tone, momSign, intBand, energy, volQ, reverbWet, gainMul) {
    if (intBand < 1) return '$: silence;\n';

    const g = (0.14 * energy * gainMul).toFixed(3);

    // Stab chords — sparse, dark, just root+fifth or minor triads
    let changes;
    if (tone === 1) {
      if (momSign > 0)      changes = "<Am Dm Em Fm>";
      else if (momSign < 0) changes = "<Am Gm Fm Em>";
      else                  changes = "<Am Dm Am Em>";
    } else {
      // Phrygian: darker sus/dim colors
      if (momSign > 0)      changes = "<Am Bbm Cm Dm>";
      else if (momSign < 0) changes = "<Am Gm Fm Bbm>";
      else                  changes = "<Am Dm Am Bbm>";
    }

    // Rhythm: offbeat stabs, busier at high intBand
    const struct = intBand >= 2
      ? "~ [~@2 x] [~ x] ~"       // more hits
      : "~ [~@2 x] ~ ~";          // single offbeat stab

    const delayTime = (60 / 132 * 0.75).toFixed(4); // dotted-8th delay

    return `$: chord("${changes}").dict("ireal").voicing()`
      + `.struct("${struct}")`
      + `.s("sawtooth").lpf(${Math.round(800 + volQ * 600)})`
      + `.decay(0.15).sustain(0)`
      + `.gain(${g})`
      + `.delay(0.35).delaytime(${delayTime}).delayfeedback(0.45)`
      + `.room(${reverbWet})`
      + `.pan(0.4).orbit(1);\n`;
  }

  // ── Synth line: hypnotic repeating figure, filter-swept ──
  function synthCode(tone, momSign, intBand, energy, volQ, price, gainMul) {
    const g = (0.12 * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "A3:minor" : "A3:phrygian";

    // Directional contour
    let synthPattern;
    if (momSign > 0) {
      synthPattern = intBand >= 2
        ? "[0 2 4 6] [2 4 6 7] [4 6 7 9] [6 7 9 11]"
        : "[0 ~ 2 ~] [4 ~ 6 ~]";
    } else if (momSign < 0) {
      synthPattern = intBand >= 2
        ? "[11 9 7 6] [9 7 6 4] [7 6 4 2] [6 4 2 0]"
        : "[7 ~ 6 ~] [4 ~ 2 ~]";
    } else {
      synthPattern = intBand >= 2
        ? "[0|2] [4|6] [7|4] [2|0] [6|7] [4|2] [0|4] [2|6]"
        : "[0|2] ~ [4|6] ~";
    }

    // Filter sweep on the synth line too — techno is ALL about filters
    const filterLo = Math.round(300 + price * 400);
    const filterHi = Math.round(filterLo + 600 + volQ * 1400);
    const sweepSpeed = Math.round(4 + volQ * 12);

    return `$: note("${synthPattern}").scale("${scale}")`
      + `.iter(4).palindrome()`
      + `.degradeBy(${(volQ * 0.3).toFixed(2)})`
      + `.s("square").lpf(sine.range(${filterLo}, ${filterHi}).slow(${sweepSpeed}))`
      + `.lpq(${(3 + volQ * 8).toFixed(1)})`
      + `.decay(0.1).sustain(0)`
      + `.gain(${g})`
      + `.delay(0.2).delaytime(${(60 / 132 / 2).toFixed(4)}).delayfeedback(0.3)`
      + `.pan(0.6).orbit(2);\n`;
  }

  // ── Pad: dark evolving drone, heavy reverb ──
  function padCode(tone, momSign, energy, volQ, reverbWet, roomSize, gainMul) {
    const g = (0.10 * energy * gainMul).toFixed(3);

    // Dark voicings — fifths and octaves, minimal thirds
    let padNotes;
    if (tone === 1) {
      // Minor
      if (momSign > 0)      padNotes = "<[A2,E3,A3] [C3,G3,C4] [D3,A3,D4] [E3,B3,E4]>";
      else if (momSign < 0) padNotes = "<[A3,E4,A4] [G3,D4,G4] [F3,C4,F4] [E3,B3,E4]>";
      else                  padNotes = "<[A2,E3,A3] [D3,A3,D4] [A2,E3,A3] [E3,B3,E4]>";
    } else {
      // Phrygian — darker with b2
      if (momSign > 0)      padNotes = "<[A2,E3,A3] [Bb2,F3,Bb3] [C3,G3,C4] [D3,A3,D4]>";
      else if (momSign < 0) padNotes = "<[A3,E4,A4] [G3,D4,G4] [F3,C4,F4] [Bb2,F3,Bb3]>";
      else                  padNotes = "<[A2,E3,A3] [D3,A3,D4] [A2,E3,A3] [Bb2,F3,Bb3]>";
    }

    return `$: note("${padNotes}").s("sawtooth")`
      + `.attack(1.5).release(3).sustain(0.4)`
      + `.lpf(${Math.round(400 + volQ * 800)})`
      + `.gain(${g})`
      + `.room(${(parseFloat(reverbWet) + 0.2).toFixed(2)}).rsize(${(parseFloat(roomSize) + 2).toFixed(1)})`
      + `.pan(sine.range(0.3, 0.7).slow(16))`
      + `.orbit(1);\n`;
  }

  // ── Noise texture: filtered noise sweep for tension ──
  function noiseCode(volQ, energy, gainMul) {
    if (volQ < 0.3) return '$: silence;\n';

    const g = (0.04 * energy * volQ * gainMul).toFixed(3);
    const sweepSpeed = Math.round(8 + volQ * 24);

    return `$: s("pink").lpf(sine.range(300, ${Math.round(800 + volQ * 2000)}).slow(${sweepSpeed}))`
      + `.hpf(200).gain(${g})`
      + `.room(0.5).rsize(4)`
      + `.pan(cosine.range(0.3, 0.7).slow(12))`
      + `.orbit(5);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // TRACK OBJECT
  // ════════════════════════════════════════════════════════════

  return {
    name: "signal_berlin",
    label: "Signal Berlin",
    category: "music",
    cpm: 33, // 132 BPM / 4 beats per cycle

    voices: {
      kick:  { label: "Kick",  default: 1.0 },
      hihat: { label: "Hi-Hat", default: 1.0 },
      clap:  { label: "Clap",  default: 1.0 },
      perc:  { label: "Perc",  default: 1.0 },
      bass:  { label: "Bass",  default: 1.0 },
      stab:  { label: "Stab",  default: 1.0 },
      synth: { label: "Synth", default: 1.0 },
      pad:   { label: "Pad",   default: 1.0 },
      noise: { label: "Noise", default: 1.0 },
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
      const tone  = data.tone !== undefined ? data.tone : 0; // default bearish — techno is dark
      const tr    = q(data.trade_rate || 0, 0.1);
      const vel   = q(data.velocity || 0, 0.1);
      const volQ  = q(data.volatility || 0, 0.1);
      const mom   = q(data.momentum || 0, 0.1);
      const price = q(data.price || 0.5, 0.1);

      // ── 2. Derived values ──
      const rawIntensity = 0.6 * tr + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
      const energy = h; // raw heat = energy — silence at zero
      const momSign = Math.abs(mom) < 0.15 ? 0 : (mom > 0 ? 1 : -1);
      const reverbWet = (0.25 + volQ * 0.3).toFixed(2);
      const roomSize = (2 + volQ * 4).toFixed(1);

      // ── 3. Cache check ──
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${intBand}:${volQ}:${mom}:${price}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // ── 4. Build code ──
      let code = "setcpm(33);\n\n";

      // Pad — first to appear, last to leave (h > 0.08)
      code += h > 0.08
        ? padCode(tone, momSign, energy, volQ, reverbWet, roomSize, this.getGain('pad'))
        : '$: silence;\n';

      // Bass — acid line enters early (h > 0.15)
      code += bassCode(tone, momSign, intBand, h, energy, volQ, price, this.getGain('bass'));

      // Kick — progressive from h > 0.15
      code += h > 0.15
        ? kickCode(h, intBand, energy, this.getGain('kick'))
        : '$: silence;\n';

      // Hi-hat — enters at h > 0.20, subdivision tracks intBand
      code += hihatCode(h, intBand, energy, this.getGain('hihat'));

      // Clap — enters at h > 0.30
      code += clapCode(h, intBand, energy, reverbWet, this.getGain('clap'));

      // Supporting perc — enters at h > 0.50
      code += percCode(h, intBand, energy, this.getGain('perc'));

      // Stab — dark chord hits, need intBand >= 1
      code += h > 0.35
        ? stabCode(tone, momSign, intBand, energy, volQ, reverbWet, this.getGain('stab'))
        : '$: silence;\n';

      // Synth line — hypnotic figure when momentum or high heat
      code += (Math.abs(mom) > 0.2 || h > 0.55)
        ? synthCode(tone, momSign, intBand, energy, volQ, price, this.getGain('synth'))
        : '$: silence;\n';

      // Noise texture — tension layer at high volatility
      code += noiseCode(volQ, energy, this.getGain('noise'));

      // ── 5. Cache and return ──
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        // Industrial crash hit — distorted, dark
        return `$: s("<cr:1 ~ ~ ~>").gain(${gain}).distort(0.4).hpf(2000).room(0.5).rsize(4).orbit(5);`;
      }
      if (type === "price_move") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 0;
        const scale = tone === 1 ? "A3:minor" : "A3:phrygian";
        // Directional acid run — filter opens dramatically
        const run = dir > 0
          ? "[0 2 4 6 7 9]"
          : "[9 7 6 4 2 0]";
        return `$: note("${run}").scale("${scale}").s("sawtooth")`
          + `.lpf(2500).lpq(12).ftype("24db")`
          + `.decay(0.1).sustain(0)`
          + `.gain(${gain}).distort(0.2)`
          + `.delay(0.3).delaytime(${(60 / 132 / 2).toFixed(4)}).delayfeedback(0.4)`
          + `.orbit(5);`;
      }
      if (type === "resolved") {
        const result = msg.result || 1;
        // Resolution: sustained power chord, reverb wash
        const chord = result > 0 ? "A2,E3,A3" : "A2,Eb3,A3";
        return `$: note("${chord}").s("sawtooth")`
          + `.attack(0.5).release(4).sustain(0.3)`
          + `.lpf(1200).distort(0.15)`
          + `.gain(0.06).room(0.8).rsize(6).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("signal_berlin", signalBerlin);
