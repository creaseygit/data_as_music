// category: 'music', label: 'Poolside House'

const poolsideHouse = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  return {
    name: "poolside_house",
    label: "Poolside House",
    category: "music",
    cpm: 29, // ~116 BPM — relaxed daytime house tempo

    init() {
      _cachedCode = null;
      _cachedKey = null;
    },

    evaluateCode(data) {
      // --- 1. Extract & quantize signals ---
      const h = Math.round((data.heat || 0.4) * 20) / 20;
      const tone = data.tone !== undefined ? data.tone : 1;
      const tradeRate = Math.round((data.trade_rate || 0.3) * 10) / 10;
      const velocity = Math.round((data.velocity || 0.3) * 10) / 10;
      const volat = Math.round((data.volatility || 0.2) * 10) / 10;
      const mom = Math.round((data.momentum || 0) * 10) / 10;
      const price = Math.round((data.price || 0.5) * 10) / 10;

      // Intensity band: 0=chill, 1=grooving, 2=vibing hard
      const rawIntensity = 0.6 * tradeRate + 0.4 * velocity;
      const intBand = rawIntensity < 0.33 ? 0 : rawIntensity < 0.66 ? 1 : 2;

      // --- 2. Cache check ---
      const key = `${h}:${tone}:${intBand}:${volat}:${mom}:${price}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // --- 3. Derived values ---
      const energy = 0.35 + h * 0.55; // poolside never goes silent, never too loud
      const filterBase = 600 + price * 1400; // brighter when price is high
      const reverbWet = (0.3 + volat * 0.35).toFixed(2); // more airy when volatile
      const roomSize = (2 + volat * 4).toFixed(1);

      // --- 4. Build code ---
      let code = "setcpm(29);\n\n";

      // ==============================
      // LAYER 1: Soft four-on-the-floor kick
      // ==============================
      const kickGain = (0.35 * energy).toFixed(3);
      code += `// Soft, round kick\n`;
      code += `$: s("bd bd bd bd").gain(${kickGain}).lpf(100).orbit(4);\n\n`;

      // ==============================
      // LAYER 2: Rhodes / EP chords — the sunlight-on-water shimmer
      // ==============================
      // Poolside house loves major 7ths, 9ths — jazz-adjacent warmth
      const chordsBullish = "<C^7 Am9 Dm9 G7>";
      const chordsBearish = "<Am7 Fm9 Dm7 E7>";
      const changes = tone === 1 ? chordsBullish : chordsBearish;
      const epGain = (0.25 * energy).toFixed(3);
      // Offbeat stabs — that classic house comp rhythm
      code += `// Rhodes chords — jazzy, offbeat stabs\n`;
      code += `$: chord("${changes}").dict("ireal").voicing()`;
      code += `.struct("~ [~@2 x] ~ [~@2 x]")`;
      code += `.s("gm_epiano1").gain(${epGain})`;
      code += `.room(${reverbWet}).rsize(${roomSize})`;
      code += `.lpf(${Math.round(filterBase)})`;
      code += `.pan(0.4).orbit(1);\n\n`;

      // ==============================
      // LAYER 3: Bouncy, funky bassline
      // ==============================
      // Melodic bass that walks — more movement at higher intensity
      const bassGain = (0.3 * energy).toFixed(3);
      const bassLpf = Math.round(300 + h * 400); // opens up with heat
      let bassPattern;
      if (tone === 1) {
        bassPattern = intBand >= 1
          ? "<[C2 ~ E2 ~] [A2 ~ C3 A2] [D2 ~ F2 ~] [G2 ~ B2 G2]>"
          : "<C2 A2 D2 G2>";
      } else {
        bassPattern = intBand >= 1
          ? "<[A1 ~ C2 ~] [F2 ~ A2 F2] [D2 ~ F2 ~] [E2 ~ G#2 E2]>"
          : "<A1 F2 D2 E2>";
      }
      code += `// Funky, bouncy bassline\n`;
      code += `$: note("${bassPattern}").s("sawtooth")`;
      code += `.lpf(${bassLpf}).lpq(3).decay(0.3).sustain(0)`;
      code += `.gain(${bassGain}).orbit(3);\n\n`;

      // ==============================
      // LAYER 4: Organic percussion — shakers, claps, rimshots
      // ==============================
      const percGain = (0.2 * energy).toFixed(3);
      let percCode;
      if (intBand === 0) {
        // Minimal: just a gentle shaker
        percCode = `$: s("hh*8").gain(${(0.12 * energy).toFixed(3)}).hpf(9000).pan(0.6).orbit(4);\n`;
        percCode += `$: silence;\n`; // placeholder for clap layer
        percCode += `$: silence;\n`; // placeholder for bongo layer
      } else if (intBand === 1) {
        // Add claps on 2&4, open hat on offbeats
        percCode = `$: s("hh*8").gain(${(0.15 * energy).toFixed(3)}).hpf(9000).pan(0.6).orbit(4);\n`;
        percCode += `$: s("~ cp ~ cp").gain(${percGain}).room(${reverbWet}).pan(0.55).orbit(4);\n`;
        percCode += `$: s("~ oh ~ oh").gain(${(0.1 * energy).toFixed(3)}).hpf(7000).pan(0.65).orbit(4);\n`;
      } else {
        // Full groove: shaker, claps, bongos/rim
        percCode = `$: s("hh*16").gain(${`perlin.range(${(0.08 * energy).toFixed(3)}, ${(0.18 * energy).toFixed(3)})`}).hpf(9000).pan(0.6).orbit(4);\n`;
        percCode += `$: s("~ cp ~ cp").gain(${percGain}).room(${reverbWet}).pan(0.55).orbit(4);\n`;
        percCode += `$: s("rim(3,8)").gain(${(0.12 * energy).toFixed(3)}).room(0.3).pan(0.7).orbit(4);\n`;
      }
      code += `// Organic percussion\n`;
      code += percCode;
      code += `\n`;

      // ==============================
      // LAYER 5: Plucked synth melody — short, harp-like melodic motifs
      // ==============================
      // Activates when there's some momentum or movement
      const melodyActive = Math.abs(mom) > 0.2 || h > 0.5;
      const melodyGain = (0.18 * energy).toFixed(3);
      const scale = tone === 1 ? "C4:major" : "A4:minor";
      if (melodyActive) {
        const melodyPattern = intBand >= 2
          ? "<[0 2 4 ~] [4 6 7 ~] [7 4 2 ~] [6 4 2 0]>"
          : "<[0 ~ 4 ~] [4 ~ 7 ~] [7 ~ 4 ~] [6 ~ 2 ~]>";
        code += `// Plucked synth melody\n`;
        code += `$: note("${melodyPattern}").scale("${scale}")`;
        code += `.s("triangle").decay(0.15).sustain(0)`;
        code += `.gain(${melodyGain}).room(${reverbWet}).rsize(${roomSize})`;
        code += `.delay(0.25).delaytime(${(60 / 116 / 2).toFixed(4)}).delayfeedback(0.35)`;
        code += `.pan(0.35).orbit(2);\n\n`;
      } else {
        code += `$: silence;\n\n`;
      }

      // ==============================
      // LAYER 6: Atmospheric pad — airy, background warmth
      // ==============================
      const padGain = (0.12 * energy).toFixed(3);
      const padChanges = tone === 1
        ? "<[C3,E3,G3,B3] [A3,C4,E4,G4] [D3,F3,A3,C4] [G3,B3,D4,F4]>"
        : "<[A3,C4,E4,G4] [F3,A3,C4,E4] [D3,F3,A3,C4] [E3,G#3,B3,D4]>";
      code += `// Warm atmospheric pad\n`;
      code += `$: note("${padChanges}").s("triangle")`;
      code += `.attack(0.8).release(2).sustain(0.6)`;
      code += `.gain(${padGain}).lpf(${Math.round(filterBase * 0.7)})`;
      code += `.room(${(parseFloat(reverbWet) + 0.15).toFixed(2)}).rsize(${(parseFloat(roomSize) + 1).toFixed(1)})`;
      code += `.pan(sine.range(0.3, 0.7).slow(16))`;
      code += `.orbit(1);\n`;

      // --- 5. Cache and return ---
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      if (type === "spike") {
        // A gentle cymbal wash — not a crash, more of a shimmer
        const gain = (0.02 + (msg.magnitude || 0.5) * 0.03).toFixed(3);
        return `$: s("<oh:3 ~ ~ ~>").gain(${gain}).room(0.6).rsize(4).hpf(5000).orbit(5);`;
      }
      if (type === "price_move") {
        // A little melodic flourish — ascending or descending pluck run
        const dir = msg.direction || 1;
        const mag = msg.magnitude || 0.5;
        const gain = (0.04 + mag * 0.04).toFixed(3);
        const tone = data.tone !== undefined ? data.tone : 1;
        const scale = tone === 1 ? "C5:major" : "A4:minor";
        const run = dir > 0
          ? "[0 2 4 6]"  // ascending
          : "[6 4 2 0]"; // descending
        return `$: note("${run}").scale("${scale}").s("triangle").decay(0.12).sustain(0).gain(${gain}).room(0.4).delay(0.2).delayfeedback(0.3).orbit(5);`;
      }
      if (type === "resolved") {
        // Final resolution — a warm, held chord
        const result = msg.result || 1;
        const chord = result > 0 ? "C3,E3,G3,B3" : "A3,C4,E4,G4";
        return `$: note("${chord}").s("gm_epiano1").attack(0.5).release(4).gain(0.08).room(0.7).rsize(5).orbit(5);`;
      }
      return null;
    },
  };
})();

audioEngine.registerTrack("poolside_house", poolsideHouse);
