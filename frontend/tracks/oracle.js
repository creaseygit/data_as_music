// ── Oracle Track (Strudel) ───────────────────────────────
// Alert track. Silence when market is calm.
// Piano chord walks when price moves — direction matches the move.
// category: 'alert', label: 'Oracle'

const oracleTrack = {
  name: 'oracle',
  label: 'Oracle',
  category: 'alert',

  init() {},

  pattern(data) {
    const pd = data.price_delta || 0;
    const mag = Math.abs(pd);

    // No significant movement → silence
    if (mag <= 0.1) return null;

    // Scale: C major (bullish) or A minor (bearish)
    const t = data.tone !== undefined ? data.tone : 1;
    const scaleName = t === 1 ? 'C4 major' : 'A3 minor';

    // Bigger move → more chords (2-5)
    const num = Math.min(5, Math.max(2, 2 + Math.floor(mag * 5)));

    // Scale degrees: ascending for up, descending for down
    const degrees = [];
    if (pd > 0) {
      for (let i = 0; i < num; i++) degrees.push(i);
    } else {
      for (let i = num - 1; i >= 0; i--) degrees.push(i);
    }

    // Pad with rests so it doesn't loop too fast
    const rests = Array(Math.max(1, 8 - num)).fill('-');
    const pat = [...degrees, ...rests].join(' ');

    // Volume scales with magnitude and market activity
    const v = data.velocity || 0.1;
    const tr = data.trade_rate || 0.2;
    const activity = Math.min(1.0, 0.3 + v * 0.4 + tr * 0.3);
    const vol = Math.min(0.05, Math.max(0.02, 0.02 + mag * 0.06)) * activity;

    return n(pat)
      .scale(scaleName)
      .off(1/8, add("2,4"))   // strum in the third and fifth
      .sound("piano")
      .gain(vol)
      .room(0.6)
      .clip(2)
      .cpm(20);
  },

  onEvent() { return null; },
};

audioEngine.registerTrack('oracle', oracleTrack);
