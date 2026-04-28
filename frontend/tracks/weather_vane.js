// ── Weather Vane ─────────────────────────────────────
// Melody-only price direction indicator. A single vibraphone voice
// runs up when price has moved up, down when price has moved down,
// and stays silent when the price hasn't moved.
//
// Driven by `price_delta_band` — the server-decided, sensitivity-scaled
// magnitude band (-3..+3, sign = direction, |band| = phrase size):
//
//   band 0   → silence (move within the deadzone)
//   |band|=1 → 3-note run
//   |band|=2 → 5-note run
//   |band|=3 → 8-note run (full octave)
//
// The deadzone and ramps both stretch with the sensitivity slider, so
// at low sensitivity only large moves reach band 1+ and the music stays
// quiet. Dynamic range (small/med/large within the active region) is
// preserved at every setting. The server suppresses delta during the
// warmup ticks (median-smoother flush), so this track is silent on
// market load until a real move happens — no settling artifacts.
//
// Scale follows `tone` (1=major, 0=minor).
// category: 'alert', label: 'Weather Vane'

const weatherVane = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  // Ascending runs indexed by |band| (1=3-note, 2=5-note, 3=8-note).
  // Packed into the start of the cycle followed by silence so notes land
  // ~0.2s apart and the run reads as a quick scalar flourish (rather than
  // a slow dispersal across 3s). Always start on scale degree 0 so every
  // "up" move departs from the same low anchor pitch.
  const ASC = {
    1: "[0 2 4] ~ ~ ~",
    2: "[0 2 4 5 7] ~ ~",
    3: "[0 2 4 5 7 9 11 12] ~",
  };

  // Descending runs — mirror of ASC: same packing, always start on
  // scale degree 12 so every "down" move departs from the same high
  // anchor pitch.
  const DESC = {
    1: "[12 11 9] ~ ~ ~",
    2: "[12 11 9 7 5] ~ ~",
    3: "[12 11 9 7 5 4 2 0] ~",
  };

  function melodyCode(tone, band, deltaCents, gainMul) {
    const mag = Math.abs(band);
    const pattern = band > 0 ? ASC[mag] : DESC[mag];
    const scale = tone === 1 ? "C4:major" : "C4:minor";

    // Gain ramps with raw cents saturation. Saturation point scales with
    // sensitivity through the band thresholds — at low sens the same
    // 0.3→0.6 ramp fills out across a wider cents range, preserving
    // dynamic range without each track needing to know the threshold.
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
      melody: { label: "Melody", default: 1.0, meter: 'delta' },
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
      const serverBand = data.price_delta_band ?? 0;  // -3..+3, server-decided
      const moving = data.price_moving === true;
      const tone = data.tone !== undefined ? data.tone : 1;

      // Two gates:
      //   moving — per-tick price-actually-changed boolean from the server
      //   serverBand — magnitude band from the rolling cents delta, scaled
      //                by the user's sensitivity. 0 = silence (deadzone).
      // Both must be open to play.
      const band = moving ? serverBand : 0;

      const gainKey = this.getGain('melody').toFixed(2);
      const key = `${band}:${tone}:${gainKey}`;
      const cacheHit = _cachedCode && _cachedKey === key;

      const decision = band === 0
        ? (moving ? 'silence (deadzone)' : 'silence (flat)')
        : `${Math.abs(band) === 1 ? 3 : Math.abs(band) === 2 ? 5 : 8}-note ${band > 0 ? 'UP' : 'DOWN'}`;
      console.log(
        `[WV] Δ¢=${deltaCents.toFixed(3)} band=${band} moving=${moving} → ${decision}`
        + (cacheHit ? ' (cache)' : '')
      );

      if (cacheHit) return _cachedCode;

      let code = "setcpm(20);\n";

      if (band === 0) {
        code += "$: silence;\n";
      } else {
        code += melodyCode(tone, band, deltaCents, this.getGain('melody'));
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
