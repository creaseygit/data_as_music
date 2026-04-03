// ── Echo Chamber ─────────────────────────────────────
// Dub reggae at 75 BPM. Deep sub-bass dominates, one-drop drums,
// offbeat skank guitar, organ swells, and melodica fragments.
// The mixing desk IS the instrument — volatility drives heavy spring reverb,
// tape delay, and filter sweeps. Space and echo respond to market uncertainty.
// D Dorian mode (bearish) / D Mixolydian (bullish).
// category: 'music', label: 'Echo Chamber'
//
// ── DATA SIGNALS ──
// heat        0.0–1.0   Layer density — low heat strips to bass+kick ghost
// price       0.0–1.0   Filter cutoff base — brightness
// price_move -1.0–1.0   Melodica phrase triggers
// momentum   -1.0–1.0   Bass walk direction, melodic contour
// velocity    0.0–1.0   Part of intensity band — bass/drum complexity
// trade_rate  0.0–1.0   Part of intensity band — percussion density
// spread      0.0–1.0   Reverb room size
// volatility  0.0–1.0   THE dub parameter — reverb depth, delay feedback, filter sweep
// tone        0 or 1    1=mixolydian (bullish), 0=dorian (bearish)

const echoChamber = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // BPM 75 → one beat = 0.8s
  const BPM = 75;
  const BEAT = 60 / BPM; // 0.8s
  const DOTTED_8TH = (BEAT * 0.75).toFixed(4); // 0.6s — classic dub delay time

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // ════════════════════════════════════════════════════════════

  // ── Kick: one-drop style — beat 3 emphasis, progressive stages ──
  function kickCode(h, intBand, energy, gainMul) {
    const g = (0.38 * energy * gainMul).toFixed(3);
    const gLo = (0.30 * energy * gainMul).toFixed(3);

    // One-drop: beat 3 is the anchor. Build up adds beat 1.
    let pattern;
    if (h < 0.30) {
      pattern = "~ ~ bd ~";                 // pure one-drop — beat 3 only
    } else if (h < 0.50) {
      pattern = "bd ~ bd ~";                // beat 1 + 3 — half-time weight
    } else {
      pattern = "bd ~ bd ~";                // same pattern, heavier gain
      if (intBand >= 2) {
        // Ghost kick on the & of 4 at high intensity — classic dub fill
        pattern = "bd ~ bd [~ bd]";
      }
    }

    return `$: s("${pattern}").gain(perlin.range(${gLo}, ${g}))`
      + `.lpf(100).orbit(4);\n`;
  }

  // ── Snare/rimshot: one-drop beat 3 with ghost notes, HEAVY reverb ──
  function snareCode(h, intBand, energy, volQ, gainMul) {
    if (h < 0.25) return '$: silence;\n';

    const g = (0.22 * energy * gainMul).toFixed(3);
    const ghostG = (0.06 * energy * gainMul).toFixed(3);
    // Spring reverb — volatility drives depth (THE dub effect on snare)
    const snareRoom = (0.35 + volQ * 0.5).toFixed(2);
    const snareRsize = (3 + volQ * 5).toFixed(1);

    if (h < 0.40) {
      // Rimshot on beat 3 only — minimal
      return `$: s("~ ~ rim ~").gain(${g})`
        + `.room(${snareRoom}).rsize(${snareRsize}).hpf(400)`
        + `.pan(0.45).orbit(4);\n`;
    } else if (intBand < 2) {
      // Rimshot beat 3 + ghost on beat 1 — breathing
      return `$: s("[rim:1 ~] ~ rim ~").gain("${ghostG} ~ ${g} ~")`
        + `.room(${snareRoom}).rsize(${snareRsize}).hpf(400)`
        + `.pan(0.45).orbit(4);\n`;
    } else {
      // Full snare beat 3 + ghost hits — busy
      return `$: s("[sd:1 ~] [~ rim:1] sd [~ rim:1]").gain("${ghostG} ~ ${ghostG} ~ ${g} ~ ${ghostG} ~")`
        + `.room(${snareRoom}).rsize(${snareRsize}).hpf(400)`
        + `.degradeBy(0.15)`
        + `.pan(0.45).orbit(4);\n`;
    }
  }

  // ── Hi-hat: steady 8ths with open hat on offbeats ──
  function hihatCode(h, intBand, energy, volQ, gainMul) {
    if (h < 0.20) return '$: silence;\n';

    const gLo = (0.06 * energy * gainMul).toFixed(3);
    const gHi = (0.16 * energy * gainMul).toFixed(3);
    // Delay on hats — dub echo effect
    const hhDelay = (0.1 + volQ * 0.2).toFixed(2);
    const hhFeedback = (0.2 + volQ * 0.3).toFixed(2);

    if (intBand === 0) {
      // Quarter notes — minimal pulse, offbeats only
      return `$: s("~ hh ~ hh").gain(perlin.range(${gLo}, ${gHi}))`
        + `.hpf(7000).delay(${hhDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${hhFeedback})`
        + `.pan(0.6).orbit(4);\n`;
    } else if (intBand === 1) {
      // 8ths with open hat on offbeats — classic reggae
      return `$: stack(s("hh*8").gain(perlin.range(${gLo}, ${gHi})),`
        + `s("oh").struct("~ x ~ x").gain(${(0.08 * energy * gainMul).toFixed(3)}).degradeBy(0.3))`
        + `.hpf(7000).delay(${hhDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${hhFeedback})`
        + `.pan(0.6).orbit(4);\n`;
    } else {
      // 8ths with strong open hat offbeats + iter for movement
      return `$: stack(s("hh*8").gain(perlin.range(${gLo}, ${gHi})).iter(4),`
        + `s("oh").struct("~ x ~ x").gain(${(0.10 * energy * gainMul).toFixed(3)}))`
        + `.hpf(7000).delay(${hhDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${hhFeedback})`
        + `.pan(0.6).orbit(4);\n`;
    }
  }

  // ── Percussion: woodblock and shaker fragments — drop in/out ──
  function percCode(h, intBand, energy, volQ, gainMul) {
    if (h < 0.40) return '$: silence;\n';

    const g = (0.10 * energy * gainMul).toFixed(3);
    const percDelay = (0.15 + volQ * 0.25).toFixed(2);
    const percFb = (0.25 + volQ * 0.35).toFixed(2);

    if (intBand < 1) {
      // Sparse woodblock — euclidean, dropping in and out
      return `$: s("cb").struct("x(3,8)").degradeBy(0.4)`
        + `.gain(${g}).hpf(3000)`
        + `.delay(${percDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${percFb})`
        + `.pan(0.65).orbit(4);\n`;
    } else if (intBand < 2) {
      // Woodblock + shaker
      return `$: stack(`
        + `s("cb").struct("x(3,8)").degradeBy(0.3).gain(${g}),`
        + `s("hh:3*16").gain(${(0.04 * energy * gainMul).toFixed(3)}).hpf(10000).degradeBy(0.5))`
        + `.delay(${percDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${percFb})`
        + `.pan(0.65).orbit(4);\n`;
    } else {
      // Full percussion — woodblock pattern + shaker + rim euclidean
      return `$: stack(`
        + `s("cb").struct("x(5,8)").gain(${g}).iter(3),`
        + `s("hh:3*16").gain(${(0.05 * energy * gainMul).toFixed(3)}).hpf(10000).degradeBy(0.4),`
        + `s("rim").struct("x(3,16)").gain(${(0.06 * energy * gainMul).toFixed(3)}).degradeBy(0.3))`
        + `.delay(${percDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${percFb})`
        + `.pan(0.65).orbit(4);\n`;
    }
  }

  // ── Bass: deep sub, THE dominant element — syncopated root-fifth movement ──
  function bassCode(tone, momSign, intBand, h, energy, volQ, price, gainMul) {
    if (h < 0.12) return '$: silence;\n';

    const g = (0.35 * energy * gainMul).toFixed(3);
    // Filter: price sets brightness, volatility darkens (inverse — uncertain = muddy)
    const bassLpf = Math.round(200 + price * 300 - volQ * 100);

    // D Dorian (bearish) / D Mixolydian (bullish)
    // Progression: Dm → Gm → Am → Dm (i–iv–v–i)
    let bassPattern;
    if (tone === 1) {
      // Mixolydian — slightly brighter, C natural
      if (intBand >= 2) {
        // Busy: walking syncopated lines with direction
        if (momSign > 0)      bassPattern = "<[D2 ~ E2 F#2] [G2 ~ A2 B2] [A2 ~ B2 C3] [D3 ~ C3 A2]>";
        else if (momSign < 0) bassPattern = "<[D3 ~ C3 A2] [A2 ~ G2 F#2] [G2 ~ F#2 E2] [D2 ~ E2 D2]>";
        else                  bassPattern = "<[D2 ~ A2 ~] [G2 ~ D2 ~] [A2 ~ E2 ~] [D2 ~ A1 D2]>";
      } else if (intBand >= 1) {
        // Mid: half-time groove with root-fifth
        if (momSign > 0)      bassPattern = "<[D2 ~ ~ A2] [G2 ~ ~ D3] [A2 ~ ~ E3] [D2 ~ ~ A2]>";
        else if (momSign < 0) bassPattern = "<[D3 ~ ~ A2] [A2 ~ ~ G2] [G2 ~ ~ D2] [D2 ~ ~ A1]>";
        else                  bassPattern = "<[D2 ~ ~ A2] [G2 ~ ~ D2] [A2 ~ ~ E2] [D2 ~ ~ A1]>";
      } else {
        // Sparse: whole notes — one per bar, deep and sustained
        if (momSign > 0)      bassPattern = "<D2 G2 A2 D3>";
        else if (momSign < 0) bassPattern = "<D3 A2 G2 D2>";
        else                  bassPattern = "<D2 G2 A2 D2>";
      }
    } else {
      // Dorian — darker, Bb natural
      if (intBand >= 2) {
        if (momSign > 0)      bassPattern = "<[D2 ~ E2 F2] [G2 ~ A2 Bb2] [A2 ~ Bb2 C3] [D3 ~ C3 A2]>";
        else if (momSign < 0) bassPattern = "<[D3 ~ C3 Bb2] [A2 ~ G2 F2] [G2 ~ F2 E2] [D2 ~ E2 D2]>";
        else                  bassPattern = "<[D2 ~ A2 ~] [G2 ~ D2 ~] [A2 ~ E2 ~] [D2 ~ A1 D2]>";
      } else if (intBand >= 1) {
        if (momSign > 0)      bassPattern = "<[D2 ~ ~ A2] [G2 ~ ~ D3] [A2 ~ ~ E3] [D2 ~ ~ A2]>";
        else if (momSign < 0) bassPattern = "<[D3 ~ ~ A2] [A2 ~ ~ G2] [G2 ~ ~ D2] [D2 ~ ~ A1]>";
        else                  bassPattern = "<[D2 ~ ~ A2] [G2 ~ ~ D2] [A2 ~ ~ E2] [D2 ~ ~ A1]>";
      } else {
        if (momSign > 0)      bassPattern = "<D2 G2 A2 D3>";
        else if (momSign < 0) bassPattern = "<D3 A2 G2 D2>";
        else                  bassPattern = "<D2 G2 A2 D2>";
      }
    }

    // Deep sine sub — round and warm, no distortion
    return `$: note("${bassPattern}").s("sine")`
      + `.lpf(${Math.max(bassLpf, 120)}).decay(0.6).sustain(0.4)`
      + `.gain(${g}).orbit(3);\n`;
  }

  // ── Skank: muted offbeat guitar chops — the reggae heartbeat ──
  function skankCode(tone, intBand, energy, volQ, price, gainMul) {
    const g = (0.14 * energy * gainMul).toFixed(3);
    // Filter: brighter at high price, darker at low
    const skankLpf = Math.round(800 + price * 1200 - volQ * 300);

    // Classic offbeat skank: "chick" on the &'s
    // Struct defines offbeat hits — busier at higher intBand
    let struct;
    if (intBand < 1) {
      struct = "~ x ~ x";                   // simple offbeats — 2 and 4
    } else if (intBand < 2) {
      struct = "~ x [~ x] x";              // extra offbeat on beat 3
    } else {
      struct = "~ x [~ x] [x x]";          // busy comping
    }

    // Use Dm chord family — simple triads for authentic skank
    let chordProg;
    if (tone === 1) {
      chordProg = "<Dm Gm Am Dm>";          // brighter — mixolydian context
    } else {
      chordProg = "<Dm Gm Am7b5 Dm>";       // darker — dorian
    }

    // Short, percussive pluck — muted guitar emulation
    return `$: chord("${chordProg}").dict("ireal").voicing()`
      + `.struct("${struct}")`
      + `.s("triangle").decay(0.05).sustain(0)`
      + `.lpf(${Math.max(skankLpf, 500)}).hpf(300)`
      + `.gain(${g})`
      + `.every(5, x => x.ply(2))`
      + `.pan(0.35).orbit(1);\n`;
  }

  // ── Organ: sustained pad swells — dub organ bubble ──
  function organCode(tone, momSign, energy, volQ, price, gainMul) {
    const g = (0.12 * energy * gainMul).toFixed(3);
    const organRoom = (0.3 + volQ * 0.4).toFixed(2);
    const organLpf = Math.round(600 + price * 800);

    // Organ pad voicings — fifths and octaves, warm
    let padNotes;
    if (tone === 1) {
      if (momSign > 0)      padNotes = "<[D3,A3,D4] [G3,D4,G4] [A3,E4,A4] [D3,A3,D4]>";
      else if (momSign < 0) padNotes = "<[D4,A4,D5] [A3,E4,A4] [G3,D4,G4] [D3,A3,D4]>";
      else                  padNotes = "<[D3,A3,D4] [G3,D4,G4] [A3,E4,A4] [D3,A3,D4]>";
    } else {
      if (momSign > 0)      padNotes = "<[D3,A3,D4] [G3,Bb3,D4] [A3,C4,E4] [D3,F3,A3]>";
      else if (momSign < 0) padNotes = "<[D4,F4,A4] [A3,C4,E4] [G3,Bb3,D4] [D3,F3,A3]>";
      else                  padNotes = "<[D3,A3,D4] [G3,Bb3,D4] [A3,C4,E4] [D3,F3,A3]>";
    }

    return `$: note("${padNotes}").s("triangle")`
      + `.attack(0.8).release(2.0).sustain(0.5)`
      + `.lpf(${organLpf})`
      + `.gain(${g})`
      + `.room(${organRoom}).rsize(${(2 + volQ * 4).toFixed(1)})`
      + `.pan(sine.range(0.35, 0.65).slow(16))`
      + `.orbit(1);\n`;
  }

  // ── Melody: melodica/horn fragments — brief phrases, not continuous ──
  function melodyCode(tone, momSign, intBand, energy, volQ, gainMul) {
    const g = (0.14 * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "D4:mixolydian" : "D4:dorian";

    // Dub melodica: brief directional phrases, heavy delay
    let melodyPattern;
    if (momSign > 0) {
      melodyPattern = intBand >= 2
        ? "[0 2 4 6] [2 4 6 7] [4 ~ 6 ~] [7 ~ ~ ~]"
        : "[0 ~ 2 ~] [4 ~ 6 ~] [7 ~ ~ ~] [~ ~ ~ ~]";
    } else if (momSign < 0) {
      melodyPattern = intBand >= 2
        ? "[7 6 4 2] [6 4 2 0] [4 ~ 2 ~] [0 ~ ~ ~]"
        : "[7 ~ 6 ~] [4 ~ 2 ~] [0 ~ ~ ~] [~ ~ ~ ~]";
    } else {
      melodyPattern = intBand >= 2
        ? "[0|2] [4|6] [~|7] [~|4] [2|6] [~|0] [4|2] [~|~]"
        : "[0|4] ~ [2|6] ~ [7|4] ~ [~|0] ~";
    }

    // Heavy dub delay — dotted-eighth tape echo, volatility drives feedback
    const melDelay = (0.25 + volQ * 0.25).toFixed(2);
    const melFb = (0.3 + volQ * 0.35).toFixed(2);
    const melRoom = (0.3 + volQ * 0.35).toFixed(2);

    return `$: note("${melodyPattern}").scale("${scale}")`
      + `.iter(4).palindrome()`
      + `.degradeBy(${(0.2 + volQ * 0.3).toFixed(2)})`
      + `.s("square").lpf(${Math.round(1200 + volQ * -400)}).lpq(2)`
      + `.decay(0.3).sustain(0.1).release(0.5)`
      + `.gain(${g})`
      + `.delay(${melDelay}).delaytime(${DOTTED_8TH}).delayfeedback(${melFb})`
      + `.room(${melRoom}).rsize(${(3 + volQ * 4).toFixed(1)})`
      + `.pan(0.4).orbit(2);\n`;
  }

  // ── FX: filtered noise wash — tension/atmosphere at high volatility ──
  function fxCode(volQ, energy, gainMul) {
    if (volQ < 0.3) return '$: silence;\n';

    const g = (0.03 * energy * volQ * gainMul).toFixed(3);
    const sweepSpeed = Math.round(12 + volQ * 20);

    // Filtered noise sweep — dub siren / atmosphere
    return `$: s("pink").lpf(sine.range(200, ${Math.round(600 + volQ * 1200)}).slow(${sweepSpeed}))`
      + `.hpf(150).gain(${g})`
      + `.room(0.6).rsize(5)`
      + `.delay(0.2).delaytime(${DOTTED_8TH}).delayfeedback(0.4)`
      + `.pan(cosine.range(0.3, 0.7).slow(16))`
      + `.orbit(5);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // TRACK OBJECT
  // ════════════════════════════════════════════════════════════

  return {
    name: "echo_chamber",
    label: "Echo Chamber",
    category: "music",
    cpm: 18.75, // 75 BPM / 4 beats per cycle

    voices: {
      kick:   { label: "Kick",     default: 1.0 },
      snare:  { label: "Snare",    default: 1.0 },
      hihat:  { label: "Hi-Hat",   default: 1.0 },
      perc:   { label: "Perc",     default: 1.0 },
      bass:   { label: "Bass",     default: 1.0 },
      skank:  { label: "Skank",    default: 1.0 },
      organ:  { label: "Organ",    default: 1.0 },
      melody: { label: "Melody",   default: 1.0 },
      fx:     { label: "FX",       default: 1.0 },
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
      const tone  = data.tone !== undefined ? data.tone : 0; // default bearish — dub is dark
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

      // ── 3. Cache check ──
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${intBand}:${volQ}:${mom}:${price}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // ── 4. Build code ──
      let code = "setcpm(18.75);\n\n";

      // Bass — first to appear, dominant (h > 0.12)
      code += bassCode(tone, momSign, intBand, h, energy, volQ, price, this.getGain('bass'));

      // Organ pad — enters early, warm bed (h > 0.10)
      code += h > 0.10
        ? organCode(tone, momSign, energy, volQ, price, this.getGain('organ'))
        : '$: silence;\n';

      // Kick — one-drop, enters at h > 0.15
      code += h > 0.15
        ? kickCode(h, intBand, energy, this.getGain('kick'))
        : '$: silence;\n';

      // Snare/rimshot — enters at h > 0.25 (with heavy reverb)
      code += snareCode(h, intBand, energy, volQ, this.getGain('snare'));

      // Hi-hat — enters at h > 0.20
      code += hihatCode(h, intBand, energy, volQ, this.getGain('hihat'));

      // Skank — offbeat guitar, enters at h > 0.20
      code += h > 0.20
        ? skankCode(tone, intBand, energy, volQ, price, this.getGain('skank'))
        : '$: silence;\n';

      // Percussion — woodblock/shaker, enters at h > 0.40
      code += percCode(h, intBand, energy, volQ, this.getGain('perc'));

      // Melody — melodica fragments, momentum-driven or high heat
      code += (Math.abs(mom) > 0.2 || h > 0.55)
        ? melodyCode(tone, momSign, intBand, energy, volQ, this.getGain('melody'))
        : '$: silence;\n';

      // FX — noise atmosphere at high volatility
      code += fxCode(volQ, energy, this.getGain('fx'));

      // ── 5. Cache and return ──
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        // Dub siren hit — reverb splash on a rimshot
        return `$: s("<rim:2 ~ ~ ~>").gain(${gain})`
          + `.room(0.8).rsize(6).hpf(800)`
          + `.delay(0.4).delaytime(${DOTTED_8TH}).delayfeedback(0.55)`
          + `.orbit(5);`;
      }
      if (type === "price_move") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.03 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 0;
        const scale = tone === 1 ? "D4:mixolydian" : "D4:dorian";
        // Melodica run — directional phrase with heavy echo
        const run = dir > 0
          ? "[0 2 4 6 7]"
          : "[7 6 4 2 0]";
        return `$: note("${run}").scale("${scale}")`
          + `.s("square").lpf(1400).lpq(2)`
          + `.decay(0.25).sustain(0.1).release(0.4)`
          + `.gain(${gain})`
          + `.delay(0.4).delaytime(${DOTTED_8TH}).delayfeedback(0.5)`
          + `.room(0.5).rsize(4).orbit(5);`;
      }
      if (type === "resolved") {
        const result = msg.result || 1;
        // Resolution: sustained organ chord with massive reverb wash
        const chord = result > 0 ? "D3,A3,D4,F#4" : "D3,A3,D4,F4";
        return `$: note("${chord}").s("triangle")`
          + `.attack(0.8).release(5).sustain(0.4)`
          + `.lpf(1000).gain(0.06)`
          + `.room(0.9).rsize(8).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("echo_chamber", echoChamber);
