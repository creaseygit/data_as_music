// ── Late Night in Bb ─────────────────────────────────────
// Jazz piano trio over Autumn Leaves changes. 120 BPM.
// Price direction drives ascending/descending scale movement
// across melody runs, chord voicings, and the full arrangement.
// Complexity and volume scale with market activity.
// Major: Cm7→F7→BbΔ7→EbΔ7→Am7b5→D7→Gm7→turnaround
// Minor: Gm7→Am7b5→D7→Gm7→Cm7→F7→BbΔ7→D7→Gm
// category: 'music', label: 'Late Night in Bb'

const jazzTrioTrack = (() => {
  let _cachedDirectional = null;
  let _cachedDirectionalKey = null;
  let lastSpikeAt = 0;

  return {
    name: 'jazz_trio',
    label: 'Late Night in Bb',
    category: 'music',

    init() {
      _cachedDirectional = null;
      _cachedDirectionalKey = null;
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
      const sp = data.spread || 0.2;

      const layers = [];

      // Spread controls reverb spaciousness
      const rm = 0.12 + sp * 0.18;
      const rs = 1.5 + sp * 2.5;

      // ── RIDE CYMBAL (spang-a-lang) ──
      // Quarter-note pulse: sustained wash on every beat
      // Gain scales with heat — whisper-quiet when calm
      layers.push(
        sound("[cr:0 cr:1 cr:0 cr:1]")
          .speed(rand.range(0.92, 1.05))
          .gain(rand.range(0.02 + h * 0.03, 0.04 + h * 0.04))
          .end(0.35)
          .room(rm).rsize(rs)
      );

      // Skip notes on beats 2 and 4 ("ding — ding-ga")
      layers.push(
        sound("[~ ~ ~ ~ ~ cr:2 ~ ~ ~ ~ ~ cr:2]")
          .speed(rand.range(1.0, 1.15))
          .gain(rand.range(0.015 + h * 0.015, 0.03 + h * 0.02))
          .end(0.15)
          .room(rm).rsize(rs)
      );

      // ── HI-HAT FOOT (2 and 4) ──
      layers.push(
        sound("[~ hh:0 ~ hh:0]")
          .speed(2.0)
          .gain(0.02 + h * 0.02)
          .end(0.012)
          .hpf(5000)
      );

      // ── FEATHERED KICK ──
      // All 4 quarters, barely audible — felt not heard
      layers.push(
        sound("[bd:3 bd:3 bd:3 bd:3]")
          .speed(0.7)
          .gain(0.01 + h * 0.012)
          .lpf(100)
          .degradeBy(0.15)
      );

      // ── WALKING BASS (16-bar: two choruses through the changes) ──
      // Tone switches between Bb major and Gm minor progressions
      // Price controls LPF brightness (higher price = brighter bass)
      const bassLine = t === 1
        ? cat(
            // Chorus 1 — straight walk (Autumn Leaves in Bb)
            "[c2 d2 eb2 e2]",         // Cm7: scale walk, E approaches F
            "[f2 a2 ab2 bb2]",        // F7: up to 3rd, chromatic to Bb
            "[bb2 a2 g2 f2]",         // BbΔ7: descending
            "[eb2 f2 g2 ab2]",        // EbΔ7: ascending
            "[a2 g2 f2 eb2]",         // Am7b5: descending
            "[d2 fs2 a2 ab2]",        // D7: up the chord, Ab approaches G
            "[g2 f2 eb2 d2]",         // Gm7: descending
            "[c2 eb2 f2 b1]",         // Turnaround: Cm7/F7
            // Chorus 2 — variations
            "[g1 bb1 c2 e2]",         // Cm7: deeper foundation
            "[f2 eb2 d2 [a2 bb2]]",   // F7: 8th-note propulsion
            "[bb2 d3 c3 a2]",         // BbΔ7: contrary motion
            "[eb2@2 f2 ab2]",         // EbΔ7: half-note breathing room
            "[c2 eb2 g2 f2]",         // Am7b5: from b3rd
            "[d2 a2 fs2 [gs2 a2]]",   // D7: chromatic 8th approach
            "[g2@2 bb2 a2]",          // Gm7: arrival, let it ring
            "[c2 eb2 [f2 ab2] [g2 b1]]", // Turnaround: 8th-note figure
          )
        : cat(
            // Chorus 1 — Gm minor emphasis
            "[g1 a1 bb1 d2]",         // Gm7: root ascending
            "[a1 c2 eb2 d2]",         // Am7b5: ascending, D approaches next
            "[d2 fs2 a2 ab2]",        // D7: arpeggio up, Ab approaches G
            "[g1 bb1 d2 c2]",         // Gm7: arpeggio, C approaches next
            "[c2 d2 eb2 e2]",         // Cm7: ascending scale
            "[f2 a2 ab2 bb2]",        // F7: 3rd, approach Bb
            "[bb2 a2 g2 f2]",         // BbΔ7: descending
            "[d2 a2 fs2 g1]",         // D7→Gm: resolves to G
            // Chorus 2 — variations
            "[g1 d2 bb1 a1]",         // Gm7: bounce pattern
            "[a1 eb2 c2 [cs2 d2]]",   // Am7b5: chromatic approach
            "[d2 a2 fs2 [gs2 a2]]",   // D7: 8th-note approach
            "[g1 bb1 d2 [cs2 d2]]",   // Gm7: approach
            "[c2 eb2 g2 e2]",         // Cm7: ascending arpeggio
            "[f2 eb2 c2 bb1]",        // F7: descending
            "[bb2 f2 d2 a1]",         // BbΔ7: descending arpeggio
            "[d2 fs2 a2 [ab2 g1]]",   // D7→Gm: 8th-note resolution
          );

      layers.push(
        bassLine.note().sound("gm_acoustic_bass")
          .clip(1)
          .gain(0.20 + h * 0.15)
          .lpf(500 + pr * 500)
          .hpf(60)
          .room(rm * 0.4).rsize(rs)
          .speed(rand.range(0.98, 1.02))
      );

      // ── PIANO COMPING (syncopated jazz voicings) ──
      // Rootless voicings (3rd, 5th, 7th) through the changes
      // Each bar has a unique comping rhythm — no two bars hit the same way
      // Gain drops when directional melody is active to leave space
      const compGainLo = mag >= 0.05 ? 0.04 + h * 0.05 : 0.08 + h * 0.10;
      const compGainHi = mag >= 0.05 ? 0.08 + h * 0.08 : 0.15 + h * 0.15;

      const compPat = t === 1
        ? note(`<
            [~ [~@2 [eb3,g3,bb3]] ~ [~@2 [eb3,g3,bb3]]]
            [[~@2 [a3,c4,eb4]] ~ ~ [a3,c4,eb4]]
            [~ [d3,f3,a3] ~ [~@2 [d3,f3,a3]]]
            [~ ~ [~@2 [g3,bb3,d4]] ~]
            [~ [~@2 [c3,eb3,g3]] [~@2 [c3,eb3,g3]] ~]
            [~ [fs3,a3,c4] ~ [~@2 [fs3,a3,c4]]]
            [[~@2 [bb2,d3,f3]] ~ ~ [~@2 [bb2,d3,f3]]]
            [~ [~@2 [eb3,g3,bb3]] ~ [a3,c4,eb4]]
          >`)
        : note(`<
            [~ [~@2 [bb2,d3,f3]] ~ [~@2 [bb2,d3,f3]]]
            [[~@2 [c3,eb3,g3]] ~ ~ [c3,eb3,g3]]
            [~ [fs3,a3,c4] ~ [~@2 [fs3,a3,c4]]]
            [~ ~ [~@2 [bb2,d3,f3]] ~]
            [~ [~@2 [eb3,g3,bb3]] [~@2 [eb3,g3,bb3]] ~]
            [~ [a3,c4,eb4] ~ [~@2 [a3,c4,eb4]]]
            [[~@2 [d3,f3,a3]] ~ ~ [~@2 [d3,f3,a3]]]
            [~ [~@2 [fs3,a3,c4]] ~ [bb2,d3,f3]]
          >`);

      layers.push(
        compPat.sound("piano")
          .clip(1)
          .gain(rand.range(compGainLo, compGainHi))
          .room(rm).rsize(rs)
          .delay(0.12).delaytime(0.18).delayfeedback(0.2)
      );

      // ── ENERGY-GATED LAYERS ──
      // Complexity builds with market activity

      // Ghost snare — brush-on-snare texture
      if (h > 0.2) {
        layers.push(
          sound("[~@2 sd:1] ~ [~@2 sd:1] ~")
            .speed(rand.range(1.1, 1.4))
            .gain(rand.range(0.008, 0.018) + h * 0.008)
            .end(0.035)
            .room(rm).rsize(rs)
            .degradeBy(0.35 + (1 - h) * 0.3)
        );
      }

      // Cross-stick rim clicks
      if (tr > 0.25) {
        layers.push(
          sound("~ ~ ~ rim")
            .gain(0.015 + tr * 0.015)
            .degradeBy(0.5)
            .room(rm).rsize(rs)
        );
      }

      // Ride bell accents on 2 and 4
      if (h > 0.5) {
        layers.push(
          sound("[~ cr:3 ~ cr:3]")
            .speed(rand.range(1.4, 1.7))
            .gain(rand.range(0.015, 0.03))
            .end(0.08)
            .hpf(4000)
            .room(rm).rsize(rs)
            .degradeBy(0.5)
        );
      }

      // Snare bombs on triplet partial
      if (tr > 0.5) {
        layers.push(
          sound("[~ ~ ~ ~ ~ sd:1 ~ ~ ~ ~ ~ ~]")
            .speed(1.1)
            .gain(0.025 + tr * 0.015)
            .end(0.05)
            .room(rm * 1.5).rsize(rs)
            .degradeBy(0.35)
        );
      }

      // Hi-hat splash
      if (v > 0.4) {
        layers.push(
          sound("[~ ~ ~ ~ ~ ~ hh:0 ~ ~ ~ ~ ~]")
            .speed(1.3)
            .gain(0.018 + v * 0.012)
            .end(0.08)
            .hpf(2500)
            .room(rm).rsize(rs)
            .degradeBy(0.5)
        );
      }

      // Kick bombs — jazz "drops" (8-bar pattern from the original)
      if (h > 0.6) {
        layers.push(
          sound(`<
            [bd:3 ~ ~ ~]
            [bd:3 ~ [~@2 bd:3] ~]
            [bd:3 ~ ~ ~]
            [~ ~ bd:3 ~]
            [bd:3 ~ ~ [~@2 bd:3]]
            [bd:3 ~ [~@2 bd:3] ~]
            [bd:3 ~ ~ ~]
            [~ ~ ~ ~]
          >`)
            .gain(0.10 + h * 0.06)
            .room(rm * 0.5)
        );
      }

      // Turnaround fill (bar 8 only)
      if (h > 0.7) {
        layers.push(
          sound("<~ ~ ~ ~ ~ ~ ~ [~ ~ [sd:1 ~] [~ ~ sd:1]]>")
            .gain(0.12 + h * 0.06)
            .room(rm).rsize(rs)
        );
      }

      // ── DIRECTIONAL LAYERS (price_move) ──
      // When price moves, melody runs and chord voicings trace the direction.
      // Ascending runs for price up, descending for price down.
      // Magnitude controls how many notes/chords (more movement = longer runs).
      // When price is flat, these layers are absent — just the trio grooves.
      if (mag >= 0.05) {
        const dir = pm >= 0 ? 'up' : 'down';
        const root = t === 1 ? 'Bb4' : 'G4';
        const scaleType = t === 1 ? 'major' : 'minor';
        const numMelody = Math.min(8, Math.max(2, Math.ceil(mag * 8)));
        const numChords = Math.min(5, Math.max(2, 2 + Math.floor(mag * 4)));

        const cacheKey = `${dir}:${numMelody}:${numChords}:${t}`;
        if (!_cachedDirectional || _cachedDirectionalKey !== cacheKey) {
          const scaleNotes = getScaleNotes(root, scaleType, 16, 2);

          // ── Melody: single-note jazz run ──
          // Scale notes ascending or descending, padded with rests
          let melodyNotes;
          if (dir === 'up') {
            melodyNotes = scaleNotes.slice(0, numMelody);
          } else {
            melodyNotes = scaleNotes.slice(0, numMelody).reverse();
          }
          const melodyRests = Array(Math.max(1, 4 - Math.floor(numMelody / 2))).fill('~');
          const melodyStr = [...melodyNotes.map(n => noteToStrudel(n)), ...melodyRests].join(' ');

          // ── Chords: 7th-chord voicings walking the scale ──
          // Diatonic 7ths (root, 3rd, 5th, 7th) ascending or descending
          const chords = [];
          for (let i = 0; i < numChords; i++) {
            const idx = dir === 'up' ? i : (numChords - 1 - i);
            const r = noteToStrudel(scaleNotes[idx]);
            const third = noteToStrudel(scaleNotes[idx + 2]);
            const fifth = noteToStrudel(scaleNotes[idx + 4]);
            const seventh = noteToStrudel(scaleNotes[idx + 6]);
            chords.push(`[${r},${third},${fifth},${seventh}]`);
          }
          const chordRests = Array(Math.max(2, 5 - numChords)).fill('~');
          const chordStr = [...chords, ...chordRests].join(' ');

          const vol = 0.03 + mag * 0.05;

          _cachedDirectional = {
            melody: note(melodyStr)
              .sound("piano")
              .clip(1)
              .gain(sine.range(vol, vol * 1.3).slow(3))
              .room(rm).rsize(rs)
              .delay(0.08).delaytime(0.18).delayfeedback(0.15),
            chords: note(chordStr)
              .sound("piano")
              .clip(2)
              .gain(sine.range(vol * 0.6, vol * 0.9).slow(3))
              .room(rm * 1.3).rsize(rs)
              .delay(0.12).delaytime(0.18).delayfeedback(0.2),
          };
          _cachedDirectionalKey = cacheKey;
        }

        layers.push(_cachedDirectional.melody);
        layers.push(_cachedDirectional.chords);
      } else {
        _cachedDirectional = null;
        _cachedDirectionalKey = null;
      }

      return stack(...layers).cpm(30); // 120 BPM
    },

    onEvent(type, msg, data) {
      const t = data.tone !== undefined ? data.tone : 1;
      const mag = Math.abs(data.price_delta || 0);

      if (type === "spike") {
        const now = Date.now();
        if (now - lastSpikeAt < 15000) return null;
        lastSpikeAt = now;
        // Crash cymbal swell
        return sound("cr:4")
          .speed(0.6).end(0.4).gain(0.06).room(0.25).rsize(0.7);
      }

      if (type === "price_move") {
        // Quick melodic fill: ascending or descending scale run
        const root = t === 1 ? 'Bb4' : 'G4';
        const scaleType = t === 1 ? 'major' : 'minor';
        const sc = getScaleNotes(root, scaleType, 14, 2);
        const num = Math.min(6, Math.max(2, 2 + Math.floor(mag * 5)));
        const ns = msg.direction > 0
          ? sc.slice(0, num)
          : sc.slice(0, num).reverse();
        return note(ns.map(n => noteToStrudel(n)).join(" "))
          .sound("piano").end(1.5)
          .gain(Math.min(0.10, 0.04 + mag * 0.06))
          .delay(0.25).delaytime(0.375).delayfeedback(0.2)
          .room(0.3).rsize(0.8);
      }

      if (type === "resolved") {
        // Full scale run: ascending for Yes, descending for No
        const r = msg.result || 1;
        const scaleType = r === 1 ? 'major' : 'minor';
        const sc = getScaleNotes("Bb4", scaleType, 8, 1);
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

audioEngine.registerTrack("jazz_trio", jazzTrioTrack);
