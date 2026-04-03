// ── Digging in the Markets ────────────────────────────
// Dusty, mellow lo-fi hip hop beats. Swung drums, Rhodes chords with jazz
// voicings, warm sine bass, sparse pentatonic melodies, vinyl texture.
// Flat keys (Bb major / G minor) for that warm lo-fi register.
// Heat controls layer density; momentum drives melodic contour.
// category: 'music', label: 'Digging in the Markets'
//
// ── DATA SIGNALS ──
// heat        0.0–1.0   Overall market activity — controls layer density
// price       0.0–1.0   Current price — drives filter warmth
// momentum   -1.0–1.0   Sustained trend direction — drives melodic contour
// velocity    0.0–1.0   Price velocity magnitude — part of intensity band
// trade_rate  0.0–1.0   Trades per minute — part of intensity band
// volatility  0.0–1.0   Price oscillation — drives reverb, detuning, wobble
// tone        0 or 1    1=major/bullish (Bb major), 0=minor/bearish (G minor)

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

  // ── Rhodes: jazz voicings, warm — all diatonic progressions ──
  function keysCode(tone, momSign, intBand, energy, volat, gainMul) {
    let changes;
    if (tone === 1) {
      // Bb major — diatonic, roots follow momentum direction
      if (momSign > 0)      changes = "<Bb^7 Cm7 Dm7 Eb^7>";      // I→ii→iii→IV rising
      else if (momSign < 0) changes = "<Eb^7 Dm7 Cm7 Bb^7>";      // IV→iii→ii→I falling
      else                  changes = "<Bb^7 Gm7 Cm7 F7>";        // I→vi→ii→V turnaround
    } else {
      // G minor — diatonic, roots follow momentum direction
      if (momSign > 0)      changes = "<Gm7 Bb^7 Cm7 Dm7>";       // i→III→iv→v rising
      else if (momSign < 0) changes = "<Dm7 Cm7 Bb^7 Gm7>";       // v→iv→III→i falling
      else                  changes = "<Gm7 Eb^7 Cm7 D7>";        // minor turnaround
    }

    const g = (0.20 * energy * gainMul).toFixed(3);

    // Comping — sparse stabs with lots of space
    const struct = intBand >= 2
      ? "~ [~@2 x] [~ x] [~@2 x]"     // busier comping
      : "~ [~@2 x] ~ [~@2 x]";        // classic offbeat stabs

    // Filter stays dark — max around 3500 Hz
    const lpf = Math.round(2000 + energy * 1500);

    return `$: chord("${changes}").dict("ireal").voicing()`
      + `.struct("${struct}")`
      + `.s("gm_epiano1")`
      + `.gain(${g})`
      + `.every(5, x => x.ply(2))`
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

  // ── Melody: pentatonic runs with delay ──
  // momAbs controls range (how far up/down the scale the melody travels)
  // momSign controls direction, intBand controls density
  function melodyCode(tone, momSign, momAbs, intBand, energy, volat, gainMul) {
    const g = (0.18 * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "Bb4:pentatonic" : "G4:minor pentatonic";

    // Momentum magnitude → melodic range
    //   small  (< 0.35): 3 degrees — gentle rocking
    //   medium (< 0.65): 5 degrees — clear climb/descent
    //   large  (≥ 0.65): 7+ degrees — full sweep
    const busy = intBand >= 2;
    let melodyPattern;

    if (momSign > 0) {
      // ── Ascending: bigger momentum = higher climb ──
      if (momAbs >= 0.65) {
        melodyPattern = busy
          ? "[0 1 2 ~] [2 4 5 ~] [4 5 6 ~] [5 6 7 ~]"       // full ascent
          : "[0 1 2 ~] [~ ~ ~ ~] [4 5 6 ~] [~ ~ ~ ~]";
      } else if (momAbs >= 0.35) {
        melodyPattern = busy
          ? "[0 1 2 ~] [2 3 4 ~] [3 4 5 ~] [4 3 2 ~]"       // moderate climb, settles back
          : "[0 1 2 ~] [~ ~ ~ ~] [3 4 5 ~] [~ ~ ~ ~]";
      } else {
        melodyPattern = busy
          ? "[0 1 2 ~] [1 2 3 ~] [2 3 2 ~] [1 2 3 ~]"       // gentle upward rocking
          : "[0 1 2 ~] [~ ~ ~ ~] [2 3 2 ~] [~ ~ ~ ~]";
      }
    } else if (momSign < 0) {
      // ── Descending: bigger momentum = deeper fall ──
      if (momAbs >= 0.65) {
        melodyPattern = busy
          ? "[7 6 5 ~] [6 5 4 ~] [5 4 2 ~] [4 2 0 ~]"       // full descent
          : "[7 6 5 ~] [~ ~ ~ ~] [4 2 1 ~] [~ ~ ~ ~]";
      } else if (momAbs >= 0.35) {
        melodyPattern = busy
          ? "[5 4 3 ~] [4 3 2 ~] [3 2 1 ~] [2 1 0 ~]"       // moderate descent
          : "[5 4 3 ~] [~ ~ ~ ~] [2 1 0 ~] [~ ~ ~ ~]";
      } else {
        melodyPattern = busy
          ? "[3 2 1 ~] [2 1 0 ~] [1 2 1 ~] [2 1 0 ~]"       // gentle downward rocking
          : "[3 2 1 ~] [~ ~ ~ ~] [1 2 1 ~] [~ ~ ~ ~]";
      }
    } else {
      // ── Neutral: no trend — wander around the middle ──
      melodyPattern = busy
        ? "[0|2] ~ [4|5] ~ [~|2] ~ [4|0] ~"
        : "[0|2] ~ ~ ~ [~|4] ~ ~ ~";
    }

    const degradeAmt = (0.15 + volat * 0.3).toFixed(2);
    const delaytime = (60 / 80 / 2).toFixed(4);  // 8th note delay

    // Flat patterns: iter + palindrome for wandering variety
    // Directional patterns: no iter (rotation wraps low→high, breaking contour)
    const transforms = momSign === 0
      ? `.iter(4).palindrome()` : ``;

    // Occasional octave shift in the direction of travel (not against it)
    const embellish = momSign < 0
      ? `.rarely(x => x.add(note(-5)))`
      : `.rarely(x => x.add(note(5)))`;

    return `$: note("${melodyPattern}").scale("${scale}")`
      + transforms
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
      melody:  { label: "Melody",  default: 1.0 },
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

      // ── 2. Derived values ──
      const rawIntensity = 0.6 * tr + 0.4 * vel;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;
      const energy = h;  // raw heat — silence is valid at 0
      const momSign = Math.abs(mom) < 0.15 ? 0 : (mom > 0 ? 1 : -1);

      // ── 3. Cache check ──
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${intBand}:${volat}:${mom}:${gainKey}`;
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

      // Rhodes chords — core harmonic element
      code += h > 0.15
        ? keysCode(tone, momSign, intBand, energy, volat, this.getGain('keys'))
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

      // Melody — sparse pentatonic, needs momentum or high heat
      code += (Math.abs(mom) > 0.2 || h > 0.45)
        ? melodyCode(tone, momSign, Math.abs(mom), intBand, energy, volat, this.getGain('melody'))
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
      if (type === "price_move") {
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.02 + mag * 0.03).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const scale = tone === 1 ? "Bb4:pentatonic" : "G4:minor pentatonic";
        const run = dir > 0 ? "[0 2 4 5]" : "[5 4 2 0]";
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
