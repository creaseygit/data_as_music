// ── Jazz Alerts ──────────────────────────────────────────
// Jazz trio: ride cymbal (cr samples), feathered kick,
// brush-like ghost snare, walking upright bass (GM soundfont),
// Salamander grand piano voicings on price movement. 100 BPM.
// Major: I-vi-ii-V (Cmaj7-Am7-Dm7-G7)
// Minor: i-iv-v-i (Am7-Dm7-Em7-Am7)
// category: 'music', label: 'Jazz Alerts'

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

      // Shared room size for cohesive acoustic space
      const rm = 0.18;
      const rs = 0.6;

      // ── RIDE CYMBAL (spang-a-lang) ──
      // cr = real ride cymbal recordings from Dirt-Samples (6 variants)
      // Quarter-note pulse: sustained wash on every beat
      layers.push(
        sound("[cr:0 cr:1 cr:0 cr:1]")
          .speed(rand.range(0.92, 1.05))
          .gain(rand.range(0.055, 0.075))
          .end(0.35)
          .room(rm).rsize(rs)
      );

      // Skip notes on last triplet of beats 2 and 4 ("ding — ding-ga — ding — ding-ga")
      // Softer, slightly brighter variant for contrast
      layers.push(
        sound("[~ ~ ~ ~ ~ cr:2 ~ ~ ~ ~ ~ cr:2]")
          .speed(rand.range(1.0, 1.15))
          .gain(rand.range(0.03, 0.05))
          .end(0.15)
          .room(rm).rsize(rs)
      );

      // ── HI-HAT FOOT ──
      // Beats 2 and 4: tight "chick" pedal sound
      layers.push(
        sound("[~ hh:0 ~ hh:0]")
          .speed(2.0)
          .gain(0.04 + h * 0.012)
          .end(0.012)
          .hpf(5000)
      );

      // ── FEATHERED KICK ──
      // All 4 quarter notes, barely audible — felt not heard
      layers.push(
        sound("[bd:3 bd:3 bd:3 bd:3]")
          .speed(0.7)
          .gain(0.02 + h * 0.008)
          .lpf(100)
          .degradeBy(0.12)
      );

      // ── SNARE GHOST NOTES ──
      // Quiet cross-stick/brush taps on triplet partials
      // Low gain + short end + room = natural brush-on-snare texture
      layers.push(
        sound("[~ sd:1 sd:1 ~ sd:1 ~ ~ sd:1 sd:1 ~ sd:1 ~]")
          .speed(rand.range(1.1, 1.4))
          .gain(rand.range(0.01, 0.022))
          .end(0.035)
          .room(rm).rsize(rs)
          .degradeBy(0.65)
      );

      // ── WALKING BASS (GM acoustic upright bass) ──
      // Quarter-note walk through chord tones, chromatic approach on beat 4
      // Major: Cmaj7 → Am7 → Dm7 → G7 (I-vi-ii-V turnaround)
      // Minor: Am7 → Dm7 → Em7 → Am7 (i-iv-v-i)
      const bassLine = t === 1
        ? cat(
            "[c2 d2 e2 gs1]",     // Cmaj7 — scale walk, G# approaches A
            "[a1 b1 c2 cs2]",     // Am7   — ascending, C# approaches D
            "[d2 e2 f2 fs2]",     // Dm7   — ascending, F# approaches G
            "[g1 b1 d2 b1]",      // G7    — arpeggio, B approaches C
          )
        : cat(
            "[a1 c2 e2 cs2]",     // Am7   — chord tones, C# approaches D
            "[d2 f2 e2 ds2]",     // Dm7   — root 3rd step-back, D# approaches E
            "[e2 d2 b1 bb1]",     // Em7   — descending, Bb approaches A
            "[a1 c2 e2 gs1]",     // Am7   — arpeggio, G# approaches A
          );

      layers.push(
        bassLine.note().sound("gm_acoustic_bass")
          .gain(0.32 + h * 0.08)
          .room(rm * 0.5).rsize(rs)
      );

      // ── ENERGY-RESPONSIVE LAYERS ──

      // Cross-stick comping on upbeat triplet partials
      if (tr > 0.25) {
        layers.push(
          sound("[~ ~ cb ~ ~ ~ ~ ~ ~ ~ cb ~]")
            .speed(2.2).end(0.02)
            .gain(0.025 + tr * 0.012)
            .pan(0.6)
            .room(rm).rsize(rs)
            .degradeBy(0.4)
        );
      }

      // Ride bell accents on 2 and 4 when energy builds
      // Use cr:3 at higher speed for bell-like overtones
      if (h > 0.5) {
        layers.push(
          sound("[~ cr:3 ~ cr:3]")
            .speed(rand.range(1.4, 1.7))
            .gain(rand.range(0.02, 0.04))
            .end(0.08)
            .hpf(4000)
            .room(rm).rsize(rs)
            .degradeBy(0.5)
        );
      }

      // Louder snare accent on trip-of-2 when busy (jazz "bomb")
      if (tr > 0.5) {
        layers.push(
          sound("[~ ~ ~ ~ ~ sd:1 ~ ~ ~ ~ ~ ~]")
            .speed(1.1)
            .gain(0.035 + tr * 0.018)
            .end(0.05)
            .room(rm * 1.5).rsize(rs)
            .degradeBy(0.35)
        );
      }

      // Open hi-hat splash when velocity high
      if (v > 0.4) {
        layers.push(
          sound("[~ ~ ~ ~ ~ ~ hh:0 ~ ~ ~ ~ ~]")
            .speed(1.3)
            .gain(0.025 + v * 0.012)
            .end(0.08)
            .hpf(2500)
            .room(rm).rsize(rs)
            .degradeBy(0.5)
        );
      }

      // ── PIANO CHORDS (reactive to price_move) ──
      // Jazz voicings: 7th chords (root, 3rd, 5th, 7th)
      // Salamander Grand Piano — real acoustic samples
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

          const vol = 0.025 + mag * 0.04;
          _cachedChordPat = note(pat)
            .sound("piano")
            .gain(sine.range(vol * 0.75, vol).slow(3))
            .room(0.3).rsize(0.8)
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
        // Crash cymbal swell — real cymbal sample
        return sound("cr:4")
          .speed(0.6).end(0.4).gain(0.06).room(0.25).rsize(0.7);
      }

      if (type === "price_move") {
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
          .delay(0.25).delaytime(0.375).delayfeedback(0.2)
          .room(0.3).rsize(0.8);
      }

      if (type === "resolved") {
        const r = msg.result || 1;
        const scaleType = r === 1 ? 'major' : 'minor';
        const sc = getScaleNotes("C4", scaleType, 8, 1);
        const notes = r === 1 ? sc : sc.reverse();
        return note(notes.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").end(1.5).gain(0.08)
          .delay(0.25).delaytime(0.4).delayfeedback(0.18)
          .room(0.35).rsize(0.8);
      }

      return null;
    },
  };
})();

audioEngine.registerTrack("jazz_alerts", jazzAlertsTrack);
