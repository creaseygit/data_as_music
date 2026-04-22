// ── So Over, So Back ─────────────────────────────────────
// Price-direction meme sampler. Plays "We're so back" on upward moves
// and "It's so over" on downward moves. Silent when the market is flat.
//
// Gated on `price_move` (NOT `momentum`) for the same reason as Weather
// Vane: price_move is edge-detected and exactly zero when the price is
// flat, which is what an alert wants. momentum hovers above zero on any
// jittery book and would make the samples play constantly.
//
// |price_move| magnitude selects one of three firing densities so small
// moves feel sparse and big moves feel frantic. Sensitivity is applied
// server-side as a power curve on price_move, so the Sensitivity slider
// still controls how readily the alert fires.
// category: 'funny', label: 'So Over, So Back'

const soOverSoBack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // Magnitude → firing-density band
  //   0: sparse  — sample fires roughly every 9s
  //   1: medium  — sample fires roughly every 6s
  //   2: frantic — sample fires every 3s (one per cycle)
  function magBand(absPm) {
    if (absPm < 0.25) return 0;
    if (absPm < 0.55) return 1;
    return 2;
  }

  function sampleCode(pm, gainMul) {
    const absPm = Math.abs(pm);
    const band = magBand(absPm);
    const alias = pm > 0 ? "so_back" : "so_over";

    // <> alternates slots across cycles — the more `~`s, the sparser the
    // fire rate. Using <> keeps the pattern cycle-deterministic so
    // rebuilds don't retrigger mid-sample.
    const pattern =
      band === 0 ? `<${alias} ~ ~>` :
      band === 1 ? `<${alias} ~>`   :
                   alias;

    // Gain ramps from 0.60 (just above threshold) to ~0.95 (max move).
    // Samples are pre-mastered voice clips — keep gain high so the words
    // are intelligible but leave headroom for the master slider.
    const g = (0.60 + absPm * 0.35) * gainMul;

    return `$: s("${pattern}").gain(${g.toFixed(3)}).room(0.1).orbit(2);\n`;
  }

  return {
    name: "so_over_so_back",
    label: "So Over, So Back",
    category: "funny",
    cpm: 20,  // one cycle ≈ 3s — matches the data push cadence

    voices: {
      voice: { label: "Voice", default: 1.0 },
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
      const pm = data.price_move || 0;
      const pmQ = q(pm, 0.05);
      const absPmQ = Math.abs(pmQ);

      const gainKey = this.getGain('voice').toFixed(2);
      const key = `${pmQ}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      // No active price movement → silence. price_move is edge-detected
      // so this gate is reliably zero when the market is flat.
      if (absPmQ < 0.05) {
        code += "$: silence;\n";
      } else {
        code += sampleCode(pmQ, this.getGain('voice'));
      }

      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    onEvent(type, msg, data) {
      // Single-voice sampler — no event ornamentation.
      return null;
    },
  };
})();

audioEngine.registerTrack("so_over_so_back", soOverSoBack);
