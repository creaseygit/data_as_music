// ── So Over, So Back ─────────────────────────────────────
// Price-direction meme sampler. Six-level intensity scale mapping
// signed price_delta_cents to one of six vocal samples:
//
//   large down (≥5¢)   → "so_fucking_over"
//   medium down (2–5¢) → "so_over"
//   small down (0.5–2¢)→ "over"
//   small up (0.5–2¢)  → "back"
//   medium up (2–5¢)   → "so_back"
//   large up (≥5¢)     → "so_fucking_back"
//
// Silent when the price isn't ticking. The sample choice carries the
// intensity; firing density (sparse → frantic) layers on top so big
// moves feel both heavier (wilder sample) and more insistent (fires
// every cycle instead of every third).
//
// Same two-signal pattern as Weather Vane: `price_moving` is the hard
// per-tick gate (false → silence even if the cents lookback still
// shows a delta from a past move) and `price_delta_cents` picks the
// direction + intensity band. Cents are already sensitivity-scaled
// server-side, so no extra sensitivity hack is needed here.
// category: 'funny', label: 'So Over, So Back'

const soOverSoBack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // |price_delta_cents| → intensity band. Selects both which sample
  // plays and how densely it fires. Bands match Weather Vane.
  //   0: small  (0.5–2¢) — "back"/"over",                  fires every ~9s
  //   1: medium (2–5¢)   — "so_back"/"so_over",            fires every ~6s
  //   2: large  (≥5¢)    — "so_fucking_back"/"so_fucking_over", fires every 3s
  function intensityBand(absCents) {
    if (absCents < 2.0) return 0;
    if (absCents < 5.0) return 1;
    return 2;
  }

  const SAMPLES_UP   = ["back", "so_back", "so_fucking_back"];
  const SAMPLES_DOWN = ["over", "so_over", "so_fucking_over"];

  function sampleCode(dCents, gainMul) {
    const absC = Math.abs(dCents);
    const band = intensityBand(absC);
    const alias = dCents > 0 ? SAMPLES_UP[band] : SAMPLES_DOWN[band];

    // <> alternates slots across cycles — the more `~`s, the sparser
    // the fire rate. Using <> keeps the pattern cycle-deterministic so
    // rebuilds don't retrigger mid-sample.
    const pattern =
      band === 0 ? `<${alias} ~ ~>` :
      band === 1 ? `<${alias} ~>`   :
                   alias;

    // Gain ramps with cents saturation (saturates at 10¢, mirroring
    // Weather Vane). Samples are pre-mastered voice clips — keep gain
    // high so the words are intelligible but leave headroom for the
    // master slider.
    const sat = Math.min(1.0, absC / 10.0);
    const g = (0.60 + sat * 0.35) * gainMul;

    return `$: s("${pattern}").gain(${g.toFixed(3)}).room(0.1).orbit(2);\n`;
  }

  return {
    name: "so_over_so_back",
    label: "So Over, So Back",
    category: "funny",
    cpm: 20,  // one cycle ≈ 3s — matches the data push cadence

    voices: {
      voice: { label: "Voice", default: 1.0, meter: 'delta' },
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
      const dCentsRaw = data.price_delta_cents || 0;
      const moving = data.price_moving === true;
      const dCents = q(dCentsRaw, 0.25);  // sign preserved
      const absC = Math.abs(dCents);

      // Same two-signal gate as Weather Vane:
      //   moving — per-tick price-actually-changed boolean
      //   |cents| ≥ 0.5 — magnitude floor matching Weather Vane band 0
      const fires = moving && absC >= 0.5;

      const gainKey = this.getGain('voice').toFixed(2);
      const key = `${fires ? dCents.toFixed(2) : 'off'}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      if (!fires) {
        code += "$: silence;\n";
      } else {
        code += sampleCode(dCents, this.getGain('voice'));
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
