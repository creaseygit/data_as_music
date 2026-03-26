// ── Just Vibes ───────────────────────────────────────────
// Lo-fi hip hop. 75 BPM.
// Bullish: Fmaj7 → Em7 → Dm7 → Cmaj7
// Bearish: Dm7 → Bbmaj7 → Gm7 → Am7
// category: 'music', label: 'Just Vibes'

const justVibesTrack = (() => {
  let lastSpikeAt = 0;

  // ── Major (bullish) patterns ──
  const ROOTS_MAJ = "<f2 e2 d2 c2>";
  const BASS_MAJ  = "<[f2@3 ~ c3 bb2 f2@2] [~ e2@2 g2 a2@2 ~@2] [d2@2 g2 f2 ~ a2 d2 ~] [g2 f2 ~@2 c2@2 ds2@2]>";
  const PAD_MAJ   = "<a3 g3 f3 e3>";
  const DEEP_MAJ  = "<f4 e4 d4 c4>";

  // ── Minor (bearish) patterns ──
  const ROOTS_MIN = "<d2 bb1 g1 a1>";
  const BASS_MIN  = "<[d2@3 ~ a2 g2 d2@2] [~ bb1@2 cs2 ds2@2 ~@2] [g1@2 c2 bb1 ~ d2 g1 ~] [e2 d2 ~@2 a1@2 c2@2]>";
  const PAD_MIN   = "<a3 f3 d3 e3>";
  const DEEP_MIN  = "<d4 bb3 g3 a3>";

  return {
    name: 'just_vibes',
    label: 'Just Vibes',
    category: 'music',

    init() { lastSpikeAt = 0; },

    pattern(data) {
      const h  = data.heat || 0.3;
      const pr = data.price || 0.5;
      const v  = data.velocity || 0.1;
      const tr = data.trade_rate || 0.2;
      const t  = data.tone !== undefined ? data.tone : 1;
      const pd = data.price_delta || 0;
      const maj = t === 1;

      // ── Always-on layers ──
      const layers = [
        // vinyl dust
        sound("pink").slow(2)
          .speed(0.7).gain(0.25),

        // kick on 1 & 3
        sound("bd").struct("x ~ x ~")
          .speed(0.8).lpf(250)
          .gain(0.29 + h * 0.16),

        // snare on 2
        sound("sd").struct("~ x ~ ~")
          .speed(0.85).end(0.25)
          .gain(0.05 + h * 0.03)
          .room(0.55),

        // ghost snare — 15% play chance
        sound("sd").struct("~ ~ ~ x").slow(2)
          .speed(0.9).end(0.15).gain(0.02)
          .room(0.65).degradeBy(0.85),

        // sub bass
        note(maj ? ROOTS_MAJ : ROOTS_MIN).sound("sine")
          .gain(0.013 + h * 0.005)
          .lpf(165)
          .attack(0.15).sustain(0.8).release(0.8),

        // bass line (tb303-style)
        note(maj ? BASS_MAJ : BASS_MIN).sound("sawtooth")
          .gain(0.018 + h * 0.01)
          .lpf(midiToHz(52 + pr * 18)).lpq(3.6)
          .decay(0.25).release(0.1),

        // pad wash — slow(1.5) drifts against the 4-bar cycle
        note(maj ? PAD_MAJ : PAD_MIN).sound("triangle")
          .gain(Math.max(0.07, 0.26 - h * 0.12))
          .lpf(midiToHz(58 + pr * 18))
          .attack(2.5).release(5)
          .room(0.7).slow(1.5),
      ];

      // ── Activity-gated layers ──

      // rare kick ghost — 25% play chance
      if (tr > 0.4) {
        layers.push(
          sound("bd").struct("~ x ~ ~").slow(2)
            .speed(0.75).lpf(165)
            .gain((0.29 + h * 0.16) * 0.25)
            .degradeBy(0.75)
        );
      }

      // hi-hat — sparse, probabilistic
      if (tr > 0.15) {
        layers.push(
          sound("hh")
            .gain(rand.range(0.03, 0.09))
            .speed(rand.range(1.3, 1.7))
            .end(0.04).hpf(3600)
            .pan(rand.range(0.2, 0.8))
            .fast(tr > 0.5 ? 4 : 2)
            .degradeBy(0.65 - tr * 0.35)
        );
      }

      // rim tick — 16-step pattern
      if (tr > 0.2) {
        layers.push(
          sound("cb").struct("~ ~ ~ x ~ ~ x ~ ~ ~ ~ x ~ x ~ ~")
            .speed(2.8).end(0.03).gain(0.01)
            .pan(sine.range(0.4, 0.6).slow(4))
        );
      }

      // deep echo — velocity-gated
      if (v > 0.25) {
        layers.push(
          note(maj ? DEEP_MAJ : DEEP_MIN).sound("sawtooth")
            .gain(0.63 + v * 0.63)
            .lpf(280).attack(1.5).release(4)
            .delay(0.5).delaytime(1.0).delayfeedback(0.35)
            .slow(2.5)
        );
      }

      // price drift — piano on big moves
      const mag = Math.abs(pd);
      if (mag > 0.2) {
        const sc = getScaleNotes(maj ? "F4" : "D4", maj ? "major_pentatonic" : "minor_pentatonic", 20, 2);
        const num = Math.min(5, Math.max(2, 2 + Math.floor(mag * 5)));
        const ns = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        layers.push(
          note(ns.map(n => noteToStrudel(n)).join(" "))
            .sound("piano")
            .gain(Math.min(0.1, 0.04 + mag * 0.1))
            .room(0.75)
        );
      }

      // ambient drone (server-toggled)
      if (data.ambient_mode === 1) {
        layers.push(
          note("<f2 c3 f3>").sound("sawtooth")
            .gain(1.5).lpf(230)
            .attack(4).release(8)
            .room(0.85).slow(2)
        );
      }

      return stack(...layers).cpm(75 / 4);
    },

    onEvent(type, msg, data) {
      const t = data.tone !== undefined ? data.tone : 1;

      if (type === "spike") {
        const now = Date.now();
        if (now - lastSpikeAt < 15000) return null;
        lastSpikeAt = now;
        return sound("hh")
          .speed(0.45).gain(0.11).room(0.65);
      }

      if (type === "price_move") {
        const root = t === 1 ? "F4" : "D4";
        const sc = getScaleNotes(root, t === 1 ? "major" : "minor", 7, 2);
        const ns = msg.direction > 0 ? sc : sc.slice().reverse();
        return note(ns.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").gain(0.08)
          .delay(0.45).delaytime(0.75).delayfeedback(0.3)
          .room(0.8);
      }

      if (type === "resolved") {
        const r = msg.result || 1;
        const root = r === 1 ? "F4" : "D4";
        let sc = getScaleNotes(root, r === 1 ? "major" : "minor", 8, 1);
        if (r !== 1) sc = sc.reverse();
        return note(sc.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").gain(0.08)
          .delay(0.4).delaytime(0.5).delayfeedback(0.3)
          .room(0.8);
      }

      return null;
    },
  };
})();

audioEngine.registerTrack("just_vibes", justVibesTrack);
