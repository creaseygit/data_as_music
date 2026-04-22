// ── So Over, So Back ─────────────────────────────────────
// Price-direction meme sampler. Six-level intensity scale mapping
// signed price_move to one of six vocal samples:
//
//   large down  → "so_fucking_over"
//   medium down → "so_over"
//   small down  → "over"
//   small up    → "back"
//   medium up   → "so_back"
//   large up    → "so_fucking_back"
//
// Silent when the market is flat. The sample choice carries the
// intensity; firing density (sparse → frantic) layers on top so big
// moves feel both heavier (wilder sample) and more insistent (fires
// every cycle instead of every third).
//
// Gated on `price_move` (NOT `momentum`) for the same reason as
// Weather Vane: price_move is edge-detected and exactly zero when
// price is flat; momentum hovers above zero on any jittery book.
//
// Sensitivity — like Weather Vane — is interpreted as a gentle hard
// gate on top of the server's window-scaled price_move signal. The
// curve is milder than Weather Vane's since this is a "funny" track
// meant to stay reactive: at sens=0 only ~2–3¢-over-8min moves fire;
// at sens=1 any detectable move fires.
// category: 'funny', label: 'So Over, So Back'

const soOverSoBack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // |price_move| → intensity band. Selects both which sample plays and
  // how densely it fires.
  //   0: small  — "back"/"over",                  fires every ~9s
  //   1: medium — "so_back"/"so_over",            fires every ~6s
  //   2: large  — "so_fucking_back"/"so_fucking_over", fires every 3s
  function intensityBand(absPm) {
    if (absPm < 0.25) return 0;
    if (absPm < 0.55) return 1;
    return 2;
  }

  const SAMPLES_UP   = ["back", "so_back", "so_fucking_back"];
  const SAMPLES_DOWN = ["over", "so_over", "so_fucking_over"];

  function sampleCode(pm, gainMul) {
    const absPm = Math.abs(pm);
    const band = intensityBand(absPm);
    const alias = pm > 0 ? SAMPLES_UP[band] : SAMPLES_DOWN[band];

    // <> alternates slots across cycles — the more `~`s, the sparser
    // the fire rate. Using <> keeps the pattern cycle-deterministic so
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
      const sens = data.sensitivity !== undefined ? data.sensitivity : 0.5;
      const pmQ = q(pm, 0.05);
      const absPmQ = Math.abs(pmQ);

      // Mild sensitivity-aware gate. Gentler than Weather Vane's —
      // this is a funny track that should stay reactive at default
      // settings. At sens=1 any detectable move fires; at sens=0
      // roughly a 2–3¢ move over the 8min window is needed.
      const gateThresh = 0.05 + (1 - sens) * 0.15;

      const gainKey = this.getGain('voice').toFixed(2);
      const sensKey = sens.toFixed(2);
      const key = `${pmQ}:${gainKey}:${sensKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      if (absPmQ < gateThresh) {
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
