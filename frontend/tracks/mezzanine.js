// ── Mezzanine ────────────────────────────────────────────
// Ambient dub. Massive Attack / Teardrop vibes. 80 BPM.
// Am(4 bars) → F(2 bars) → G(2 bars) cycle.
// category: 'music', label: 'Mezzanine'

const mezzanineTrack = (() => {
  let lastSpikeAt = 0;

  // 8-bar chord cycle via <> (one value per bar)
  const ROOTS = "<a2 a2 a2 a2 f2 f2 g2 g2>";

  // Bass phrases: root-relative intervals with @duration weights
  const BASS = "<[a2@3 ~ e3 d3 a2@2] [~ a2@2 c3 d3@2 ~@2] [a2@2 d3 c3 ~ e3 a2 ~] [e3 d3 ~@2 a2@2 c3@2] [f2@3 ~ c3 bb2 f2@2] [~ f2@2 gs2 bb2@2 ~@2] [g2@3 ~ d3 c3 g2@2] [~ g2@2 bb2 c3@2 ~@2]>";

  // Arp: broken chord, 6 notes per bar. F/G bars same for both tones.
  const ARP_FG = "[f4 a4 c5 a4 f4 a4] [f4 a4 c5 a4 f4 a4] [g4 b4 d5 b4 g4 b4] [g4 b4 d5 b4 g4 b4]>";

  // Pad: chord tones cycling, drifts against the 8-bar cycle via slow
  const PAD = "<a3 c4 e4 g4 f3 a3 g3 b3>";

  return {
    name: 'mezzanine',
    label: 'Mezzanine',
    category: 'music',

    init() { lastSpikeAt = 0; },

    pattern(data) {
      const h  = data.heat || 0.3;
      const pr = data.price || 0.5;
      const v  = data.velocity || 0.1;
      const tr = data.trade_rate || 0.2;
      const t  = data.tone !== undefined ? data.tone : 1;
      const pd = data.price_delta || 0;

      // Arp changes with tone: bullish a4, bearish gs4
      const amArp = t === 1 ? "[a4 c5 e5 c5 a4 c5]" : "[a4 c5 e5 c5 gs4 c5]";
      const arp = "<" + amArp + " " + amArp + " " + amArp + " " + amArp + " " + ARP_FG;

      // ── Always-on layers ──
      const layers = [
        // sub bass
        note(ROOTS).sound("sine")
          .gain(0.04 + h * 0.02)
          .lpf(196)
          .attack(0.2).sustain(0.9).release(0.8),

        // bass line (tb303-style)
        note(BASS).sound("sawtooth")
          .gain(0.04 + h * 0.03)
          .lpf(midiToHz(48 + pr * 25)).lpq(5)
          .decay(0.3).release(0.1),

        // teardrop arp — degradeBy for ghost-note dropouts
        note(arp).sound("triangle")
          .gain(Math.max(0.03, 0.07 - h * 0.03))
          .lpf(midiToHz(75 + pr * 15))
          .decay(0.15).release(1.5)
          .room(0.6).roomlp(3000)
          .degradeBy(0.12),

        // kick on 1 & 3
        sound("bd").struct("x ~ x ~")
          .speed(0.85).lpf(370)
          .gain(0.32 + h * 0.24),

        // snare on 3
        sound("sd").struct("~ ~ x ~")
          .speed(0.9).end(0.3)
          .gain(0.06 + h * 0.05)
          .room(0.5),

        // vinyl dust
        sound("pink").slow(2)
          .speed(0.8).gain(0.22),

        // dub wash pad — slow(1.5) drifts against the 8-bar cycle
        note(PAD).sound("triangle")
          .gain(Math.max(0.04, 0.13 - h * 0.07))
          .lpf(midiToHz(55 + pr * 20))
          .attack(3).release(5)
          .room(0.75).slow(1.5),
      ];

      // ── Activity-gated layers (market data drives structure) ──

      // ghost kick on beat 2
      if (tr > 0.4) {
        layers.push(
          sound("bd").struct("~ x ~ ~")
            .speed(0.8).lpf(250)
            .gain((0.32 + h * 0.24) * 0.4)
        );
      }

      // ghost kick 8th-note pattern
      if (tr > 0.3) {
        layers.push(
          sound("bd").struct("~ ~ x ~ ~ x ~ ~")
            .speed(0.75).lpf(196)
            .gain(0.10 + h * 0.08)
        );
      }

      // ghost snare — 40% play chance via degradeBy
      if (tr > 0.5) {
        layers.push(
          sound("sd").struct("~ ~ ~ x").slow(2)
            .speed(1.0).end(0.2).gain(0.04)
            .room(0.6).degradeBy(0.6)
        );
      }

      // rim tick — 16-step pattern (16 elements = 16th notes natively)
      if (tr > 0.25) {
        layers.push(
          sound("cb").struct("~ ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ x ~ ~")
            .speed(2.5).end(0.04)
            .gain(0.016 + h * 0.016)
            .pan(sine.range(0.35, 0.65).slow(4))
        );
      }

      // hi-hat — sparse, probabilistic
      if (tr > 0.15) {
        layers.push(
          sound("hh")
            .gain(rand.range(0.05, 0.15))
            .speed(rand.range(1.2, 1.8))
            .end(0.05).hpf(4200)
            .pan(rand.range(0.1, 0.9))
            .fast(tr > 0.6 ? 4 : 2)
            .degradeBy(0.65 - tr * 0.35)
        );
      }

      // deep echo — velocity-gated ambient layer
      if (v > 0.3) {
        const deepNotes = t === 1 ? "<a3 c4 e4>" : "<a3 c4 gs3>";
        layers.push(
          note(deepNotes).sound("sawtooth")
            .gain(0.15 + v * 0.15)
            .lpf(370).attack(1).release(3)
            .delay(0.6).delaytime(0.75).delayfeedback(0.5)
            .room(0.5).slow(2.5)
        );
      }

      // price drift — pentatonic run on big moves
      const mag = Math.abs(pd);
      if (mag > 0.2) {
        const sc = getScaleNotes("A4", "minor_pentatonic", 14, 2);
        const num = Math.min(6, Math.max(2, 2 + Math.floor(mag * 6)));
        const driftNotes = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        layers.push(
          note(driftNotes.map(n => noteToStrudel(n)).join(" "))
            .sound("triangle")
            .gain(Math.min(0.26, 0.07 + mag * 0.22))
            .decay(0.2).release(2)
            .delay(0.5).delaytime(0.5).delayfeedback(0.45)
            .room(0.75)
        );
      }

      // ambient drone (server-toggled)
      if (data.ambient_mode === 1) {
        layers.push(
          note("<a2 e3 a3>").sound("sawtooth")
            .gain(0.4).lpf(250)
            .attack(4).release(8)
            .room(0.85).slow(2)
        );
      }

      return stack(...layers).cpm(20);
    },

    onEvent(type, msg, data) {
      const t   = data.tone !== undefined ? data.tone : 1;
      const mag = Math.abs(data.price_delta || 0);

      if (type === "spike") {
        const now = Date.now();
        if (now - lastSpikeAt < 15000) return null;
        lastSpikeAt = now;
        return sound("hh")
          .speed(0.5).gain(0.15).room(0.6);
      }

      if (type === "price_move") {
        const sc  = getScaleNotes("A4", "minor", 14, 2);
        const num = Math.min(7, Math.max(3, 3 + Math.floor(mag * 7)));
        const ns  = msg.direction > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        return note(ns.map(n => noteToStrudel(n)).join(" "))
          .sound("piano")
          .gain(Math.min(0.1, 0.04 + mag * 0.12))
          .delay(0.5).delaytime(0.75).delayfeedback(0.5)
          .room(0.8);
      }

      if (type === "resolved") {
        const r  = msg.result || 1;
        const sc = r === 1
          ? getScaleNotes("A4", "major", 8, 1)
          : getScaleNotes("A4", "minor", 8, 1).reverse();
        return note(sc.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").gain(0.1)
          .delay(0.4).delaytime(0.5).delayfeedback(0.4)
          .room(0.8);
      }

      return null;
    },
  };
})();

audioEngine.registerTrack("mezzanine", mezzanineTrack);
