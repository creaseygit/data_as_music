// ── Oracle Track (Strudel) ───────────────────────────────
// Alert track. Silence when market is calm.
// Piano chord walks when price moves — direction matches the move.
// category: 'alert', label: 'Oracle'

const oracleTrack = {
  name: 'oracle',
  label: 'Oracle',
  category: 'alert',

  _cachedPattern: null,
  _cachedKey: null,

  init() {
    this._cachedPattern = null;
    this._cachedKey = null;
  },

  pattern(data) {
    const pd = data.price_delta || 0;
    const mag = Math.abs(pd);

    // No significant movement → silence
    if (mag <= 0.1) {
      this._cachedPattern = null;
      this._cachedKey = null;
      return null;
    }

    // Scale: C major (bullish) or A minor (bearish)
    const t = data.tone !== undefined ? data.tone : 1;
    const scaleName = t === 1 ? 'C4:major' : 'A3:minor';

    // 2-5 notes based on magnitude of price move.
    // Bias toward longer runs: use sqrt to push values up the curve.
    const t01 = (mag - 0.1) / 0.9;                       // 0 at threshold, 1 at max
    const num = Math.min(5, 2 + Math.floor(Math.sqrt(t01) * 4)); // 2,3,4,5

    // Direction: positive = ascending, negative = descending
    const dir = pd > 0 ? 'up' : 'down';

    // Reuse cached pattern if direction, note count, and scale haven't changed.
    // This avoids mid-cycle pattern replacement that can swallow notes.
    const key = `${dir}:${num}:${scaleName}`;
    if (this._cachedPattern && this._cachedKey === key) {
      return this._cachedPattern;
    }

    // Scale degrees spaced by 2 (thirds) for clear pitch separation
    const degrees = [];
    if (pd > 0) {
      for (let i = 0; i < num; i++) degrees.push(i * 2);
    } else {
      for (let i = num - 1; i >= 0; i--) degrees.push(i * 2);
    }

    // Each note gets its own slot; pad with rests so it doesn't loop too fast.
    // cpm(12) → 5s cycle. With 5 notes + 3 rests = 8 slots, each slot ≈ 0.6s.
    // That gives enough separation to clearly hear ascending vs descending.
    const rests = Array(Math.max(2, 8 - num)).fill('~');
    const pat = [...degrees, ...rests].join(' ');

    // Base volume scales with magnitude and market activity
    const v = data.velocity || 0.1;
    const tr = data.trade_rate || 0.2;
    const activity = Math.min(1.0, 0.3 + v * 0.4 + tr * 0.3);
    const vol = Math.min(0.05, Math.max(0.02, 0.02 + mag * 0.06)) * activity;

    // mini() converts string to Pattern, then off() adds chord voicing before scale mapping
    const result = mini(pat)
      .off(1/8, add("2,4"))
      .n().scale(scaleName)
      .sound("piano")
      .gain(rand.range(vol * 0.6, vol * 1.2))
      .late(rand.range(0, 0.02))
      .room(rand.range(0.4, 0.7))
      .clip(2)
      .cpm(12);

    this._cachedPattern = result;
    this._cachedKey = key;
    return result;
  },

  onEvent() { return null; },
};

audioEngine.registerTrack('oracle', oracleTrack);
