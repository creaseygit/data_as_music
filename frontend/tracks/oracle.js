// ── Oracle Track (Strudel) ───────────────────────────────
// Alert track. Piano motifs respond to price movement.
// Ported from sonic_pi/oracle.rb (the original, not the Tone.js version).
// category: 'alert', label: 'Oracle'
//
// Original Sonic Pi: set_volume! 0.3, uses :piano synth with hard/vel params.
// Piano mapped to FM synthesis: low fmi for warmth, fast fmdecay for hammer strike.

const oracleTrack = {
  name: 'oracle',
  label: 'Oracle',
  category: 'alert',

  init() {},

  pattern(data) {
    const pd = data.price_delta || 0;
    const v = data.velocity || 0.1;
    const tr = data.trade_rate || 0.2;
    const t = data.tone !== undefined ? data.tone : 1;
    const mag = Math.abs(pd);

    // Sonic Pi: if mag > 0.1 ... else just sleep 3
    if (mag <= 0.1) return null;

    // Root and scale
    const root = t === 1 ? 'C4' : 'A3';
    const scaleType = t === 1 ? 'major' : 'minor';

    // num = clamp(2 + floor(mag * 6), 2, 6)
    const numNotes = Math.min(6, Math.max(2, 2 + Math.floor(mag * 6)));

    // Build note array
    let notes = getScaleNotes(root, scaleType, numNotes, 2);
    if (pd < 0) notes = notes.slice().reverse();

    // Sonic Pi: activity = [0.3 + (v * 0.4) + (tr * 0.3), 1.0].min
    const activity = Math.min(1.0, 0.3 + v * 0.4 + tr * 0.3);

    // Sonic Pi: vol = [[0.02 + (mag * 0.06), 0.02].max, 0.05].min * activity
    const vol = Math.min(0.05, Math.max(0.02, 0.02 + mag * 0.06)) * activity;

    // Sonic Pi: hard = [[0.1 + (mag * 0.4), 0.1].max, 0.3].min
    const hard = Math.min(0.3, Math.max(0.1, 0.1 + mag * 0.4));

    // Sonic Pi: vel: 0.2 + (mag * 0.5)
    const vel = 0.2 + mag * 0.5;

    // FM piano approximation of Sonic Pi :piano
    // low fmi = warm tone, fmdecay = hammer brightness
    const fmi = 0.5 + hard * 3;  // hard 0.1-0.3 → fmi 0.8-1.4 (warm, not metallic)

    // Build note pattern with per-note dynamics
    const strudelNotes = notes.map(n => noteToStrudel(n)).join(' ');

    // Sonic Pi uses with_fx :reverb, room: 0.6, damp: 0.5
    // Per-note: amp_env * 0.95, pan: (frac - 0.5) * 0.3
    // Notes play with 0.3s spacing (sleep 0.3)
    return note(strudelNotes)
      .s('fm')
      .fmi(fmi)
      .fmh(2)
      .fmdecay(0.06 + hard * 0.12)
      .attack(0.003)
      .decay(0.4 + vel * 0.3)
      .sustain(0.05)
      .release(1.2)
      .gain(vol * 0.95)
      .pan(sine.range(0.35, 0.65).slow(numNotes))
      .room(0.6)
      .roomlp(3000)
      .slow(numNotes * 0.3 / (60 / 120));
  },

  onEvent(type, msg, data) {
    // Oracle has no special event handling (original Sonic Pi has none)
    return null;
  },
};

audioEngine.registerTrack('oracle', oracleTrack);
