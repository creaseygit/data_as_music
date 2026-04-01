// ── [Track Name] ─────────────────────────────────────
// [One-line description of the track's musical concept.]
// [What data signals drive what musical elements.]
// category: 'music', label: '[Display Name]'
//
// ── HOW TO USE THIS TEMPLATE ──
// 1. Copy this file: cp _template.js my_track.js
// 2. Rename the variable and all references below
// 3. Define your voices in the `voices` object
// 4. Write your voice code generators (one function per voice)
// 5. Wire them together in evaluateCode()
// 6. Register at the bottom: audioEngine.registerTrack("my_track", myTrack)
// 7. Restart the server — tracks are auto-discovered from this folder
//
// ── KEY PRINCIPLES ──
// - Patterns are regenerated every ~3s with fresh data, not mutated
// - Music is never interrupted mid-bar (audio engine buffers to cycle boundary)
// - Always declare `cpm` so the audio engine can calculate cycle timing
// - Use `$:` labels for each voice so Strudel's pattern indexing stays stable
// - When a voice is conditionally silent, emit `$: silence;` to hold its slot
// - Multiply all .gain() values by getGain('voiceName') for mastering support
//
// ── DATA SIGNALS (see docs/data-interface.md for full details) ──
// heat        0.0–1.0   Overall market activity
// price       0.0–1.0   Current price
// price_move -1.0–1.0   Active price change (edge-detected, 30s window)
// momentum   -1.0–1.0   Sustained trend direction (sensitivity-scaled window)
// velocity    0.0–1.0   Price velocity magnitude (unsigned)
// trade_rate  0.0–1.0   Trades per minute (normalized)
// spread      0.0–1.0   Bid-ask spread (normalized)
// volatility  0.0–1.0   Price oscillation / uncertainty
// tone        0 or 1    1=major (bullish), 0=minor (bearish)
// sensitivity 0.0–1.0   Client sensitivity setting

const myTrack = (() => {
  let _cachedCode = null;
  let _cachedKey = null;

  // ── Quantize helper (reduces pattern rebuilds) ──
  function q(v, step) {
    return Math.round(v / step) * step;
  }

  // ── Scale all gain numbers in a pattern string by a factor ──
  function scaleGains(pattern, factor) {
    return pattern.replace(/\d+\.\d+/g, (m) =>
      (parseFloat(m) * factor).toFixed(3)
    );
  }

  // ════════════════════════════════════════════════════════════
  // VOICE CODE GENERATORS
  // One function per voice. Each returns a Strudel code string
  // starting with `$:`. Each receives a gain multiplier from
  // getGain() for mastering page support.
  // ════════════════════════════════════════════════════════════

  // ── Example: Kick ──
  function kickCode(energy, gainMul) {
    const g = (0.35 * energy * gainMul).toFixed(3);
    return `$: s("bd bd bd bd").gain(${g}).orbit(4);\n`;
  }

  // ── Example: Bass ──
  function bassCode(tone, energy, gainMul) {
    const g = (0.30 * energy * gainMul).toFixed(3);
    const notes = tone === 1
      ? "C2 E2 F2 G2"     // major
      : "A1 C2 D2 E2";    // minor
    return `$: note("${notes}").s("sawtooth").lpf(400).gain(${g}).orbit(3);\n`;
  }

  // ── Example: Chords ──
  function chordsCode(tone, energy, gainMul) {
    const g = (0.25 * energy * gainMul).toFixed(3);
    const changes = tone === 1
      ? "<C^7 Am7 Dm7 G7>"
      : "<Am7 Fm7 Dm7 E7>";
    return `$: chord("${changes}").dict("ireal").voicing()`
      + `.struct("~ [~@2 x] ~ [~@2 x]")`
      + `.s("piano").gain(${g}).room(0.2).orbit(1);\n`;
  }

  // ── Example: Melody (conditional — plays when movement is active) ──
  function melodyCode(tone, melodyStrength, energy, gainMul) {
    const g = (0.20 * melodyStrength * energy * gainMul).toFixed(3);
    const scale = tone === 1 ? "C4:major" : "A3:minor";
    return `$: note("<[0 2 4 ~] [4 6 7 ~]>").scale("${scale}")`
      + `.s("piano").gain(${g}).room(0.25).orbit(2);\n`;
  }

  // ════════════════════════════════════════════════════════════
  // TRACK OBJECT
  // ════════════════════════════════════════════════════════════

  return {
    name: "my_track",           // Must match registerTrack() call below
    label: "My Track",          // Display name in UI
    category: "music",          // "music" or "alert" or "diagnostic"
    cpm: 30,                    // Cycles per minute — MUST match setcpm() below

    // ── Voice declarations ──
    // The mastering page reads this to render per-voice gain sliders.
    // Keys are internal IDs (used in gains{} and getGain()).
    // Labels are human-readable names shown in the UI.
    // Default is the starting gain multiplier (1.0 = author's original level).
    //
    // Use consistent IDs where possible:
    //   kick, snare, hihat, perc, bass, chords, melody, pad, fx
    voices: {
      kick:   { label: "Kick",   default: 1.0 },
      bass:   { label: "Bass",   default: 1.0 },
      chords: { label: "Chords", default: 1.0 },
      melody: { label: "Melody", default: 1.0 },
    },

    // ── Runtime gain state ──
    // The mastering page writes here: track.gains.kick = 0.8
    // Do not set values here — they are populated at runtime.
    gains: {},

    // ── Gain helper ──
    // Returns the current gain multiplier for a voice.
    // Falls back to the voice's default, then to 1.0.
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
      const mom   = data.momentum || 0;
      const pm    = data.price_move || 0;
      const vol   = q(data.volatility || 0, 0.1);
      const tr    = data.trade_rate || 0;
      const vel   = data.velocity || 0;

      // ── 2. Derived values ──
      const energy = 0.4 + h * 0.6;   // 0.4 at rest → 1.0 at full heat
      const melodyStrength = Math.max(Math.abs(pm), Math.abs(mom) * 0.7);

      // ── 3. Cache check ──
      // Build a key from quantized values. If unchanged, return cached code.
      // Include getGain values so mastering slider changes bust the cache.
      const gainKey = Object.keys(this.voices)
        .map(v => this.getGain(v).toFixed(2)).join(':');
      const key = `${h}:${tone}:${vol}:${q(melodyStrength, 0.1)}:${gainKey}`;
      if (_cachedCode && _cachedKey === key) return _cachedCode;

      // ── 4. Build code ──
      let code = "setcpm(30);\n";

      code += kickCode(energy, this.getGain('kick'));
      code += bassCode(tone, energy, this.getGain('bass'));
      code += chordsCode(tone, energy, this.getGain('chords'));

      // Conditional melody — silent placeholder when inactive
      code += melodyStrength > 0.1
        ? melodyCode(tone, melodyStrength, energy, this.getGain('melody'))
        : '$: silence;\n';

      // ── 5. Cache and return ──
      _cachedCode = code;
      _cachedKey = key;
      return code;
    },

    // ── Events ──
    // Return a code string for evaluate-mode, or null to ignore.
    // Common events: "spike", "price_move", "resolved"
    onEvent(type, msg, data) {
      if (type === "spike") {
        const gain = (0.04 + (msg.magnitude || 0.5) * 0.04).toFixed(3);
        return `$: s("<cr:0 ~ ~ ~>").gain(${gain}).room(0.4).orbit(5);`;
      }
      return null;
    },
  };
})();

// ── Register with the audio engine ──
// The name here MUST match the `name` property above.
audioEngine.registerTrack("my_track", myTrack);
