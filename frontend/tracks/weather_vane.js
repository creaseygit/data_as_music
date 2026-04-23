// ── Weather Vane ─────────────────────────────────────
// Melody-only price direction indicator. A single vibraphone voice
// runs up when price is actively moving up, down when actively moving
// down, and stays silent when the market is flat.
//
// The point of this track is maximum clarity: price up → music up,
// price down → music down. Every ascending run starts on scale degree
// 0 (the root) and climbs. Every descending run starts on scale
// degree 12 and falls. The *length* of the run encodes magnitude —
// 3 notes for a small move, 5 for medium, 8 for a large. No rotation,
// no ornamentation, no cycle-to-cycle variation. Each run is packed
// into the first fraction of a cycle with silence trailing, so notes
// are tightly grouped in time and the "run" reads as a quick flourish.
//
// Gated on `price_move` (NOT `momentum`). `price_move` is the
// edge-detected signal that emits zero when the price is truly flat,
// and its window + saturation both scale with sensitivity — so a
// 10¢ move at sens=0 and a 3¢ move at sens=0.5 are both "saturated"
// for their timescale. `momentum` is a lagged MACD-style divergence
// that hovers above zero whenever the EMAs are out of sync (which is
// almost always on a jittery book), so using it as the gate makes the
// alert play constantly.
//
// Scale follows `tone` (1=major, 0=minor).
// Direction follows the sign of `price_move`.
// Magnitude of |price_move| selects run length and scales gain.
//
// The track applies a light sensitivity-aware hard gate on top of the
// server's window-scaled signal. The gate scales gently — 0.05 at
// sens=1.0 up to 0.25 at sens=0.0 — so the sensitivity slider retains
// meaning without suppressing most moves the server has already decided
// are meaningful. The server's edge detection handles noise rejection.
// category: 'alert', label: 'Weather Vane'

const weatherVane = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // Quantize |price_move| into three magnitude bands. The band controls
  // how many notes are in the run (3 / 5 / 8) — longer run = bigger move.
  function magBand(absPm) {
    if (absPm < 0.25) return 0;  // 3-note run
    if (absPm < 0.55) return 1;  // 5-note run
    return 2;                     // 8-note run (full octave)
  }

  // Ascending runs — packed into the start of the cycle followed by
  // silence, so notes land ~0.2s apart and the run reads as a quick
  // scalar flourish (rather than a slow dispersal across 3s).
  //   band 0: 3 notes in 1/4 cycle (0.75s), then 2.25s rest
  //   band 1: 5 notes in 1/3 cycle (1.0s), then 2.0s rest
  //   band 2: 8 notes in 1/2 cycle (1.5s), then 1.5s rest
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

  function melodyCode(tone, pm, gainMul) {
    const absPm = Math.abs(pm);
    const band = magBand(absPm);
    const pattern = pm > 0 ? ASC[band] : DESC[band];
    const scale = tone === 1 ? "C4:major" : "C4:minor";

    // Gain ramps from 0.22 (just above threshold) to 0.58 (max move).
    const g = (0.22 + absPm * 0.36) * gainMul;

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
      const pm = data.price_move || 0;
      const tone = data.tone !== undefined ? data.tone : 1;
      const sens = data.sensitivity !== undefined ? data.sensitivity : 0.5;

      // Quantize price_move — keeps cache stable across tiny variations.
      // Sign is preserved so direction survives quantization.
      const pmQ = q(pm, 0.05);
      const absPmQ = Math.abs(pmQ);

      // Sensitivity-aware hard gate. Shallow curve — 0.05 (sens=1) to
      // 0.25 (sens=0) — so the slider's main job is server-side window
      // sizing, not gating. The server's edge detection already zeroes
      // out flat/decaying moves, so even a low gate threshold doesn't
      // produce constant firing on jittery books.
      const gateThresh = 0.05 + (1 - sens) * 0.20;

      const gainKey = this.getGain('melody').toFixed(2);
      const sensKey = sens.toFixed(2);
      const key = `${pmQ}:${tone}:${gainKey}:${sensKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      let code = "setcpm(20);\n";

      if (absPmQ < gateThresh) {
        code += "$: silence;\n";
      } else {
        code += melodyCode(tone, pmQ, this.getGain('melody'));
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
