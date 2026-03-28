// ── Late Night in Bb — Jazz Piano Trio ───────────────────
// 1:1 copy of the standalone strudel.cc track.
// Only changes: $: → stack(), setcpm(30) → .cpm(30),
// and 3 sample subs (rd→cr, rim→rm, gm_acoustic_bass→triangle).
// category: 'music', label: 'Late Night in Bb'

const jazzTrioTrack = (() => {
  const changes = "<Cm7 F7 Bb^7 Eb^7 Am7b5 D7 Gm7 [Cm7 F7]>";

  return {
    name: 'jazz_trio',
    label: 'Late Night in Bb',
    category: 'music',

    init() {},

    pattern(data) {
      // ─── Piano Comping (jazz voicings, syncopated) ───
      const comping = chord(changes)
        .dict("ireal")
        .voicing()
        .struct(
          `<
          [~ [~@2 x] ~ [~@2 x]]
          [[~@2 x] ~ ~ x]
          [~ x ~ [~@2 x]]
          [~ ~ [~@2 x] ~]
          [~ [~@2 x] [~@2 x] ~]
          [~ x ~ [~@2 x]]
          [[~@2 x] ~ ~ [~@2 x]]
          [~ [~@2 x] ~ x]
        >`,
        )
        .s("piano")
        .clip(1)
        .velocity(rand.range(0.25, 0.45))
        .room(0.25)
        .roomsize(3)
        .delay(0.12)
        .delaytime(0.18)
        .delayfeedback(0.2);

      // ─── Melody ───
      const melody = note(`<
        [Eb5 D5 C5 Bb4]
        [A4@3 ~]
        [~ D5 C5 Bb4]
        [G4@3 ~]
        [C5 Eb5 D5 C5]
        [A4 F#4 G4@2]
        [G4@2 Bb4 A4]
        [G4 F4 Eb4@2]
      >`)
        .s("piano")
        .clip(1)
        .velocity(rand.range(0.45, 0.6))
        .room(0.25)
        .roomsize(3)
        .delay(0.08)
        .delaytime(0.18)
        .delayfeedback(0.15);

      // ─── Walking Bass (16-bar) ───
      // triangle synth (gm_acoustic_bass not available in @strudel/web)
      const bass = note(`<
        [C2 D2 Eb2 E2]
        [F2 A2 Ab2 Bb2]
        [Bb2 A2 G2 F2]
        [Eb2 F2 G2 Ab2]
        [A2 G2 F2 Eb2]
        [D2 F#2 A2 Ab2]
        [G2 F2 Eb2 D2]
        [C2 Eb2 F2 B1]
        [G1 Bb1 C2 E2]
        [F2 Eb2 D2 [A2 Bb2]]
        [Bb2 D3 C3 A2]
        [Eb2@2 F2 Ab2]
        [C2 Eb2 G2 F2]
        [D2 A2 F#2 [G#2 A2]]
        [G2@2 Bb2 A2]
        [C2 Eb2 [F2 Ab2] [G2 B1]]
      >`)
        .s("triangle")
        .clip(1)
        .gain(
          `<
          [0.45 0.35 0.35 0.30]
          [0.45 0.38 0.32 0.30]
          [0.45 0.35 0.35 0.32]
          [0.45 0.35 0.35 0.30]
          [0.45 0.35 0.35 0.30]
          [0.45 0.38 0.35 0.30]
          [0.45 0.35 0.32 0.30]
          [0.42 0.35 0.35 0.30]
          [0.48 0.35 0.35 0.30]
          [0.45 0.35 0.32 [0.28 0.25]]
          [0.48 0.38 0.35 0.32]
          [0.45 0.35 0.30]
          [0.42 0.35 0.38 0.32]
          [0.45 0.38 0.35 [0.28 0.25]]
          [0.48 0.38 0.30]
          [0.42 0.35 [0.32 0.28] [0.30 0.28]]
        >`,
        )
        .lpf(900)
        .hpf(60)
        .room(0.08)
        .speed(rand.range(0.98, 1.02));

      // ─── Ride Cymbal (spang-a-lang) ───
      // cr = Dirt-Samples ride (original uses rd)
      const ride = s("cr [cr@2 cr] cr [cr@2 cr]")
        .gain("0.25 [0.28 0.12] 0.3 [0.32 0.12]");

      // ─── Hi-hat (8-bar pattern) ───
      const hihat = s(`<
        [~ hh ~ hh]
        [hh hh hh hh]
        [~ hh ~ [hh [~@2 hh]]]
        [~ hh ~ hh]
        [~ hh ~ oh]
        [hh hh hh [hh [~@2 hh]]]
        [~ hh ~ hh]
        [~ hh [~@2 oh] hh]
      >`)
        .gain(
          `<
          [~ 0.30 ~ 0.24]
          [0.10 0.30 0.10 0.24]
          [~ 0.30 ~ [0.24 [~ 0.14]]]
          [~ 0.28 ~ 0.24]
          [~ 0.30 ~ 0.34]
          [0.12 0.32 0.12 [0.26 [~ 0.14]]]
          [~ 0.28 ~ 0.24]
          [~ 0.30 [~ 0.34] 0.24]
        >`,
        )
        .cut(1);

      // ─── Kick drum (jazz "bombs" — 8-bar) ───
      const kick = s(`<
        [bd ~ ~ ~]
        [bd ~ [~@2 bd] ~]
        [bd ~ ~ ~]
        [~ ~ bd ~]
        [bd ~ ~ [~@2 bd]]
        [bd ~ [~@2 bd] ~]
        [bd ~ ~ ~]
        [~ ~ ~ ~]
      >`)
        .gain(0.18);

      // ─── Ghost snare (brush-like texture) ───
      const ghost = s("[~@2 sd] ~ [~@2 sd] ~")
        .gain(rand.range(0.05, 0.09))
        .sometimesBy(0.35, (x) => x.gain(0));

      // ─── Cross-stick rim click (beat 4, probabilistic) ───
      // rm = Dirt-Samples rimshot (original uses rim)
      const rimclick = s("~ ~ ~ rm").degradeBy(0.5).gain(0.29);

      // ─── Snare/tom fill (bar 8 only — the turnaround) ───
      const fill = s("<~ ~ ~ ~ ~ ~ ~ [~ ~ [sd ~] [~ ~ sd]]>")
        .gain(0.22).room(0.15);

      return stack(
        comping, melody, bass, ride, hihat, kick, ghost, rimclick, fill
      ).cpm(30);
    },

    onEvent() { return null; },
  };
})();

audioEngine.registerTrack("jazz_trio", jazzTrioTrack);
