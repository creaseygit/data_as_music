// ── Jazz Alerts ──────────────────────────────────────────
// Jazz trio backing (drums, walking bass) with Oracle-style
// reactive piano chords. 100 BPM. Subtle brushwork, walking
// bass follows I-vi-ii-V (major) or i-iv-v-i (minor).
// Piano plays 7th-chord voicings on price movement.
// category: 'music', label: 'Jazz Alerts'

// 100 BPM = 25 cycles per minute (1 cycle = 1 bar of 4/4)
// 8-element grid = 8th notes, 4-element grid = quarter notes

const jazzAlertsTrack = (() => {
  let _cachedChordPat = null;
  let _cachedChordKey = null;
  let lastSpikeAt = 0;

  return {
    name: 'jazz_alerts',
    label: 'Jazz Alerts',
    category: 'music',

    init() {
      _cachedChordPat = null;
      _cachedChordKey = null;
      lastSpikeAt = 0;
    },

    pattern(data) {
      const h  = data.heat || 0.3;
      const pr = data.price || 0.5;
      const v  = data.velocity || 0.1;
      const tr = data.trade_rate || 0.2;
      const t  = data.tone !== undefined ? data.tone : 1;
      const pm = data.price_move || 0;
      const mag = Math.abs(pm);

      const layers = [];

      // ── JAZZ DRUMS ──

      // Ride cymbal: classic jazz pattern (1  &2  3  &4)
      // 8th-note grid, hits on positions 0,3,4,7
      const ride = sound("[hh:8 ~ ~ hh:8 hh:8 ~ ~ hh:8]")
        .speed(rand.range(0.55, 0.75))
        .gain(rand.range(0.04, 0.07))
        .hpf(3500)
        .end(0.12)
        .room(0.15);
      layers.push(ride);

      // Hi-hat foot: beats 2 and 4 (tight pedal)
      // 8th-note grid, positions 2 and 6
      const hihatFoot = sound("[~ ~ hh:0 ~ ~ ~ hh:0 ~]")
        .speed(2.0)
        .gain(0.025 + h * 0.01)
        .end(0.02)
        .hpf(5000);
      layers.push(hihatFoot);

      // Kick: beat 1 only, ghosted
      const kick = sound("[bd:3 ~ ~ ~ ~ ~ ~ ~]")
        .speed(0.7)
        .gain(0.05 + h * 0.02)
        .lpf(150)
        .degradeBy(0.15);
      layers.push(kick);

      // Snare ghost notes: very quiet brush-like taps
      // 8th-note grid, heavy degradeBy for sparse hits
      const ghostSnare = sound("[~ sd:1 ~ sd:1 ~ sd:1 ~ sd:1]")
        .speed(rand.range(1.3, 1.7))
        .gain(rand.range(0.012, 0.03))
        .end(0.03)
        .hpf(2500)
        .room(0.08)
        .degradeBy(0.55);
      layers.push(ghostSnare);

      // ── WALKING BASS ──
      // Quarter-note walks outlining chord tones
      // Last note of each bar approaches the next chord's root
      // Major: Cmaj7 → Am7 → Dm7 → G7
      // Minor: Am7 → Dm7 → Em7 → Am7
      const bassLine = t === 1
        ? cat(
            "[c2 e2 g2 b1]",     // Cmaj7 — B steps down to A
            "[a1 c2 e2 d2]",     // Am7   — D approaches Dm
            "[d2 f2 a2 g2]",     // Dm7   — G approaches G7
            "[g1 b1 d2 c2]",     // G7    — C turns around to Cmaj7
          )
        : cat(
            "[a1 c2 e2 d2]",     // Am7   — D approaches Dm
            "[d2 f2 a2 e2]",     // Dm7   — E approaches Em
            "[e2 g2 b2 a2]",     // Em7   — A approaches Am
            "[a1 e2 c2 b1]",     // Am7   — B steps down to A (turnaround)
          );

      const bass = bassLine.note().sound("sawtooth")
        .gain(0.11 + h * 0.04)
        .lpf(midiToHz(38 + pr * 18)).lpq(3)
        .attack(0.02).decay(0.12).sustain(0.5).release(0.1);
      layers.push(bass);

      // Sub bass: chord roots, pure sine
      const subRoots = t === 1
        ? "<c2 a1 d2 g1>"
        : "<a1 d2 e2 a1>";
      const sub = note(subRoots).sound("sine")
        .gain(0.08 + h * 0.03)
        .lpf(100)
        .attack(0.03).decay(0.2).sustain(0.7).release(0.15);
      layers.push(sub);

      // ── ACTIVITY-GATED LAYERS ──

      // Cross-stick on beat 4 when trade rate picks up
      if (tr > 0.3) {
        layers.push(
          sound("[~ ~ ~ ~ ~ ~ cb ~]")
            .speed(2.2).end(0.03)
            .gain(0.025 + tr * 0.015)
            .pan(0.6)
            .room(0.08)
        );
      }

      // Extra ride ghost notes when busy
      if (tr > 0.5) {
        layers.push(
          sound("[~ hh:8 ~ ~ ~ hh:8 ~ ~]")
            .speed(rand.range(0.5, 0.65))
            .gain(rand.range(0.015, 0.035))
            .hpf(4000).end(0.06)
            .degradeBy(0.45)
        );
      }

      // Brush swirl texture when velocity is high
      if (v > 0.3) {
        layers.push(
          sound("pink").end(0.06)
            .gain(0.006 + v * 0.004)
            .hpf(5000)
            .pan(sine.range(0.3, 0.7).slow(5))
        );
      }

      // ── PIANO CHORDS (Oracle-style, reactive to price_move) ──
      // Jazz voicings: 7th chords (root, 3rd, 5th, 7th) instead of triads
      if (mag >= 0.05) {
        const root = t === 1 ? 'C4' : 'A3';
        const scaleType = t === 1 ? 'major' : 'minor';
        const num = Math.min(5, 2 + Math.floor(mag * 4));
        const dir = pm >= 0 ? 'up' : 'down';

        const key = `${dir}:${num}:${root}`;
        if (!_cachedChordPat || _cachedChordKey !== key) {
          const scaleNotes = getScaleNotes(root, scaleType, 14, 2);
          const chords = [];
          for (let i = 0; i < num; i++) {
            const idx = dir === 'up' ? i : (num - 1 - i);
            const r = noteToStrudel(scaleNotes[idx]);
            const third = noteToStrudel(scaleNotes[idx + 2]);
            const fifth = noteToStrudel(scaleNotes[idx + 4]);
            const seventh = noteToStrudel(scaleNotes[idx + 6]);
            chords.push(`[${r},${third},${fifth},${seventh}]`);
          }
          const rests = Array(Math.max(2, 5 - num)).fill('~');
          const pat = [...chords, ...rests].join(' ');

          const vol = 0.02 + mag * 0.04;
          _cachedChordPat = note(pat)
            .sound("piano")
            .gain(sine.range(vol * 0.75, vol).slow(3))
            .room(0.4)
            .clip(2);
          _cachedChordKey = key;
        }
        layers.push(_cachedChordPat);
      } else {
        _cachedChordPat = null;
        _cachedChordKey = null;
      }

      return stack(...layers).cpm(25);
    },

    onEvent(type, msg, data) {
      const t = data.tone !== undefined ? data.tone : 1;
      const mag = Math.abs(data.price_delta || 0);

      if (type === "spike") {
        const now = Date.now();
        if (now - lastSpikeAt < 15000) return null;
        lastSpikeAt = now;
        // Soft cymbal swell
        return sound("hh:6")
          .speed(0.4).end(0.25).gain(0.07).room(0.3);
      }

      if (type === "price_move") {
        // Jazz scale run with delay
        const scaleType = t === 1 ? 'major' : 'minor';
        const root = t === 1 ? 'C4' : 'A3';
        const sc = getScaleNotes(root, scaleType, 14, 2);
        const num = Math.min(5, Math.max(2, 2 + Math.floor(mag * 5)));
        const ns = msg.direction > 0
          ? sc.slice(0, num)
          : sc.slice(0, num).reverse();
        return note(ns.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").end(1.5)
          .gain(Math.min(0.10, 0.05 + mag * 0.06))
          .delay(0.3).delaytime(0.375).delayfeedback(0.25)
          .room(0.35);
      }

      if (type === "resolved") {
        const r = msg.result || 1;
        const scaleType = r === 1 ? 'major' : 'minor';
        const sc = getScaleNotes("C4", scaleType, 8, 1);
        const notes = r === 1 ? sc : sc.reverse();
        return note(notes.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").end(1.5).gain(0.08)
          .delay(0.3).delaytime(0.4).delayfeedback(0.2)
          .room(0.4);
      }

      return null;
    },
  };
})();

audioEngine.registerTrack("jazz_alerts", jazzAlertsTrack);
