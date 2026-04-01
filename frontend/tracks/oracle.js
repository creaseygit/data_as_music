// ── Oracle Track (Strudel) ───────────────────────────────
// Piano chords trace the price curve directly.
// price_move (rolling 30s window) drives chord runs:
//   magnitude → number of chords (2-5)
//   sign → ascending (price up) or descending (price down)
// momentum shifts chord register (uptrend=higher, downtrend=lower)
// volatility controls reverb depth (uncertainty = more spacey)
// Major scale when bullish, minor when bearish.
// category: 'alert', label: 'Oracle'

const oracleTrack = {
  name: 'oracle',
  label: 'Oracle',
  category: 'alert',
  cpm: 40,

  _cachedPattern: null,
  _cachedKey: null,

  init() {
    this._cachedPattern = null;
    this._cachedKey = null;
  },

  pattern(data) {
    const pm = data.price_move || 0;
    const mag = Math.abs(pm);

    // No meaningful price movement → silence
    if (mag < 0.05) {
      this._cachedPattern = null;
      this._cachedKey = null;
      return null;
    }

    // Major (bullish) or minor (bearish)
    const t = data.tone !== undefined ? data.tone : 1;
    const momentum = data.momentum || 0;
    const vol_raw = data.volatility || 0;

    // Momentum shifts register: uptrend → higher voicings, downtrend → lower
    // Quantize to semitone steps for cache stability
    const regShift = Math.round(momentum * 3); // -3 to +3 semitones
    const baseMidi = t === 1 ? 60 : 57; // C4 or A3
    const rootMidi = baseMidi + regShift;
    const root = midiToNote(rootMidi);
    const scaleType = t === 1 ? 'major' : 'minor';

    // 2-5 chords based on movement magnitude
    const num = Math.min(5, 2 + Math.floor(mag * 4));

    // Direction follows the price curve
    const dir = pm >= 0 ? 'up' : 'down';

    // Volatility controls reverb depth (quantize for cache stability)
    const volQ = Math.round(vol_raw * 4) / 4; // 0, 0.25, 0.5, 0.75, 1.0

    // Return cached pattern if musical output hasn't changed
    const key = `${dir}:${num}:${root}:${volQ}`;
    if (this._cachedPattern && this._cachedKey === key) {
      return this._cachedPattern;
    }

    // Build triads from explicit note names
    const scaleNotes = getScaleNotes(root, scaleType, 14, 2);
    const chords = [];
    for (let i = 0; i < num; i++) {
      const idx = dir === 'up' ? i : (num - 1 - i);
      const r = noteToStrudel(scaleNotes[idx]);
      const third = noteToStrudel(scaleNotes[idx + 2]);
      const fifth = noteToStrudel(scaleNotes[idx + 4]);
      chords.push(`[${r},${third},${fifth}]`);
    }
    const rests = Array(Math.max(2, 5 - num)).fill('~');
    const pat = [...chords, ...rests].join(' ');

    // Volume scales with movement; slow sine gives natural per-chord dynamics
    const vol = 0.02 + mag * 0.04;

    // Reverb: baseline 0.3, scales up to 0.8 with volatility (uncertainty = spacey)
    const roomAmt = 0.3 + volQ * 0.5;
    const roomSize = 2 + volQ * 4;

    const result = note(pat)
      .sound("piano")
      .gain(sine.range(vol * 0.75, vol).slow(3))
      .room(roomAmt)
      .roomsize(roomSize)
      .clip(2)
      .cpm(40);

    this._cachedPattern = result;
    this._cachedKey = key;
    return result;
  },

  onEvent(type, msg) {
    if (type === "spike") {
      const gain = 0.03 + (msg.magnitude || 0.5) * 0.05;
      return sound("cr:1").gain(gain).room(0.6);
    }
    return null;
  },
};

audioEngine.registerTrack('oracle', oracleTrack);
