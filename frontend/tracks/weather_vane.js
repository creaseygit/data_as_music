// ── Weather Vane ─────────────────────────────────────
// Melody-only price direction indicator. A single vibraphone voice
// runs up when price has moved up, down when price has moved down,
// and stays silent when the price hasn't moved.
//
// Driven by `price_delta_cents` — the canonical "did the price move"
// signal: signed cents over a sensitivity-scaled lookback window.
// Sign decides direction, magnitude (in cents) decides scale length.
//
//   |Δ| < 0.5¢  → silence (no real movement)
//   0.5 – 2¢    → 3-note run
//   2 – 5¢      → 5-note run
//   > 5¢        → 8-note run (full octave)
//
// Magnitude in cents is the same unit you'd read off the price ticker.
// The server suppresses delta during the warmup ticks (median-smoother
// flush), so this track is silent on market load until a real move
// happens — no settling artifacts.
//
// Scale follows `tone` (1=major, 0=minor).
// category: 'alert', label: 'Weather Vane'

const weatherVane = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // Map |delta_cents| → scale-length band. Returns -1 for silence.
  function magBand(absCents) {
    if (absCents < 0.5) return -1;  // silence
    if (absCents < 2.0) return 0;   // 3-note run
    if (absCents < 5.0) return 1;   // 5-note run
    return 2;                        // 8-note run
  }

  // Ascending runs — packed into the start of the cycle followed by
  // silence, so notes land ~0.2s apart and the run reads as a quick
  // scalar flourish (rather than a slow dispersal across 3s).
  // Always start on scale degree 0 so every "up" move departs from
  // the same low anchor pitch.
  const ASC = [
    "[0 2 4] ~ ~ ~",
    "[0 2 4 5 7] ~ ~",
    "[0 2 4 5 7 9 11 12] ~",
  ];

  // Descending runs — mirror of ASC: same packing, always start on
  // scale degree 12 so every "down" move departs from the same high
  // anchor pitch.
  const DESC = [
    "[12 11 9] ~ ~ ~",
    "[12 11 9 7 5] ~ ~",
    "[12 11 9 7 5 4 2 0] ~",
  ];

  function melodyCode(tone, deltaCents, band, gainMul) {
    const pattern = deltaCents > 0 ? ASC[band] : DESC[band];
    const scale = tone === 1 ? "C4:major" : "C4:minor";

    // Gain ramps from 0.30 (band 0, ~1¢ move) up to 0.62 (>=10¢).
    // Saturates at 10¢ so further magnitude doesn't keep climbing.
    const sat = Math.min(1.0, Math.abs(deltaCents) / 10.0);
    const g = (0.30 + sat * 0.32) * gainMul;

    return `$: note("${pattern}").scale("${scale}")`
      + `.s("gm_vibraphone").n(4)`
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
      const deltaCents = data.price_delta_cents || 0;
      const tone = data.tone !== undefined ? data.tone : 1;

      // Quantize delta to 0.25¢ steps to keep the cache stable across
      // tiny variations. Sign is preserved so direction survives.
      const dQ = q(deltaCents, 0.25);
      const band = magBand(Math.abs(dQ));

      const gainKey = this.getGain('melody').toFixed(2);
      const key = `${dQ}:${tone}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      if (band < 0) {
        code += "$: silence;\n";
      } else {
        code += melodyCode(tone, dQ, band, this.getGain('melody'));
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
