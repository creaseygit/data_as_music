// ── Weather Vane ─────────────────────────────────────
// Melody-only price direction indicator. A single vibraphone voice
// runs up when price is trending up, down when trending down, and
// stays silent when the market isn't moving.
//
// Scale follows `tone` (1=major, 0=minor).
// Direction follows the sign of `momentum`.
// Magnitude of |momentum| selects one of three density bands and
// scales gain. Sensitivity is baked into `momentum` server-side
// (window-length scaling), so the sensitivity slider naturally
// controls how much movement is needed to wake the alert.
// category: 'alert', label: 'Weather Vane'

const weatherVane = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // Quantize |momentum| into three density bands
  function magBand(absMom) {
    if (absMom < 0.25) return 0;  // sparse rising/falling pings
    if (absMom < 0.55) return 1;  // 5-note runs
    return 2;                      // 8-note runs with ornamentation
  }

  // Ascending phrases — <> alternates variants across cycles so the
  // line never loops the same bar twice in a row.
  const ASC = [
    "<[~ 0 ~ 2] [~ 2 ~ 4] [~ 0 ~ 4]>",
    "<[0 2 4 5 7] [2 4 5 7 9] [0 2 4 7 9]>",
    "<[0 2 4 5 7 9 11 12] [0 2 4 7 9 11 12 14]>",
  ];

  // Descending phrases — mirror shapes of the ascending set.
  const DESC = [
    "<[~ 7 ~ 4] [~ 5 ~ 2] [~ 4 ~ 0]>",
    "<[9 7 5 4 2] [7 5 4 2 0] [9 7 4 2 0]>",
    "<[14 12 11 9 7 5 4 2] [12 11 9 7 5 4 2 0]>",
  ];

  function melodyCode(tone, mom, gainMul) {
    const absMom = Math.abs(mom);
    const band = magBand(absMom);
    const pattern = mom > 0 ? ASC[band] : DESC[band];
    const scale = tone === 1 ? "C4:major" : "C4:minor";

    // Gain ramps from 0.22 (just above threshold) to 0.58 (max move).
    const g = (0.22 + absMom * 0.36) * gainMul;

    // Per-band variation — keeps the alert fresh over long sessions.
    //  band 0: <> alternation alone is enough (sparse by design)
    //  band 1: iter(3) rotates the starting note each cycle
    //  band 2: iter + occasional octave sparkle on top notes
    let transforms = "";
    if (band >= 1) transforms += ".iter(3)";
    if (band >= 2) transforms += ".sometimes(x => x.add(note(12)))";

    return `$: note("${pattern}").scale("${scale}")`
      + `.s("gm_vibraphone").n(4)`
      + transforms
      + `.gain(${g.toFixed(3)}).room(0.25).orbit(2);\n`;
  }

  return {
    name: "weather_vane",
    label: "Weather Vane",
    category: "alert",
    cpm: 20,  // one cycle ≈ 3s — phrase aligns with data push cadence

    voices: {
      melody: { label: "Melody", default: 1.0 },
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
      const mom = data.momentum || 0;
      const tone = data.tone !== undefined ? data.tone : 1;

      // Quantize momentum — small numerical jitter shouldn't rebuild.
      // Sign is preserved so direction survives quantization.
      const momQ = q(mom, 0.05);
      const absMomQ = Math.abs(momQ);

      const gainKey = this.getGain('melody').toFixed(2);
      const key = `${momQ}:${tone}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      // No movement → no sound. Dead-zone avoids flickering on noise.
      if (absMomQ < 0.05) {
        code += "$: silence;\n";
      } else {
        code += melodyCode(tone, momQ, this.getGain('melody'));
      }

      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      // Single-voice alert — no event ornamentation.
      return null;
    },
  };
})();

audioEngine.registerTrack("weather_vane", weatherVane);
