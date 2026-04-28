// ── So Over, So Back ─────────────────────────────────────
// Price-direction meme sampler. Six-level intensity scale mapping the
// server-decided price_delta_band (-3..+3) to one of six vocal samples:
//
//   band -3 (large down)  → "so_fucking_over"
//   band -2 (medium down) → "so_over"
//   band -1 (small down)  → "over"
//   band +1 (small up)    → "back"
//   band +2 (medium up)   → "so_back"
//   band +3 (large up)    → "so_fucking_back"
//
// Silent when the price isn't ticking or the move sits inside the
// sensitivity-scaled deadzone (band 0). The sample choice carries the
// intensity; firing density (sparse → frantic) layers on top so big
// moves feel both heavier (wilder sample) and more insistent (fires
// every cycle instead of every third).
//
// Same two-signal pattern as Weather Vane: `price_moving` is the hard
// per-tick gate (false → silence even if the band still shows a non-zero
// reading from a past move) and `price_delta_band` picks the direction +
// intensity band. The sensitivity slider stretches the bands themselves
// server-side, so this track stays in lockstep with Weather Vane and
// the visual gauge at every sensitivity setting.
// category: 'funny', label: 'So Over, So Back'

const soOverSoBack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  // Band magnitude (1=small, 2=medium, 3=large) selects both which
  // sample plays and how densely it fires. The bands themselves are
  // sensitivity-scaled server-side and match Weather Vane.
  //   |band|=1 → "back" / "over"                       fires every ~9s
  //   |band|=2 → "so_back" / "so_over"                 fires every ~6s
  //   |band|=3 → "so_fucking_back" / "so_fucking_over" fires every cycle

  // Indexed by |band| (1..3) for direct lookup.
  const SAMPLES_UP   = { 1: "back", 2: "so_back", 3: "so_fucking_back" };
  const SAMPLES_DOWN = { 1: "over", 2: "so_over", 3: "so_fucking_over" };

  function sampleCode(band, dCents, gainMul) {
    const mag = Math.abs(band);
    const alias = band > 0 ? SAMPLES_UP[mag] : SAMPLES_DOWN[mag];

    // <> alternates slots across cycles — the more `~`s, the sparser
    // the fire rate. Using <> keeps the pattern cycle-deterministic so
    // rebuilds don't retrigger mid-sample.
    const pattern =
      mag === 1 ? `<${alias} ~ ~>` :
      mag === 2 ? `<${alias} ~>`   :
                  alias;

    // Gain ramps with raw cents saturation (saturates at 10¢, mirroring
    // Weather Vane). Samples are pre-mastered voice clips — keep gain
    // high so the words are intelligible but leave headroom for the
    // master slider.
    const sat = Math.min(1.0, Math.abs(dCents) / 10.0);
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
      const dCents = data.price_delta_cents || 0;
      const serverBand = data.price_delta_band ?? 0;  // -3..+3, server-decided
      const moving = data.price_moving === true;

      // Same two-signal gate as Weather Vane:
      //   moving — per-tick price-actually-changed boolean
      //   serverBand !== 0 — magnitude is outside the sensitivity-scaled
      //                      deadzone (server-decided)
      const band = moving ? serverBand : 0;
      const fires = band !== 0;

      const gainKey = this.getGain('voice').toFixed(2);
      // Quantize cents to 0.5¢ for the gain saturation curve cache.
      const centsKey = Math.round(dCents * 2) / 2;
      const key = `${fires ? `${band}@${centsKey}` : 'off'}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      if (!fires) {
        code += "$: silence;\n";
      } else {
        code += sampleCode(band, dCents, this.getGain('voice'));
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
