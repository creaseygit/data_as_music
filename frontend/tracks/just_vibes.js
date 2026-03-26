// ── Just Vibes Track (Strudel) ───────────────────────────
// Lo-fi hip hop. F major / D minor, 75 BPM.
// Ported from sonic_pi/just_vibes.rb (the original).
// category: 'music', label: 'Just Vibes'
//
// Sonic Pi synth mapping (same as mezzanine):
//   :piano  → s('fm') low fmi, fast fmdecay
//   :tb303  → s('sawtooth') with lpf/lpq
//   :hollow → s('triangle') with lpf + high room
//   :dark_ambience → s('sawtooth') with heavy lpf + room
//   :sine   → s('sine')
//
// Amp values from mastered Sonic Pi source (with ~nf factors).

const justVibesTrack = (() => {
  let chordIdx = 0;
  let lastSpikeAt = 0;
  const SPIKE_COOLDOWN = 15000;

  function _rrand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function _choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Sonic Pi: lofi_roots — tone-dependent root notes
  function _getRoots(tone) {
    return tone === 1
      ? ['f2', 'e2', 'd2', 'c2']
      : ['d2', 'bb1', 'g1', 'a1'];
  }

  // Sonic Pi: lofi_chords — 7th chord voicings per chord position
  // Fmaj7, Em7, Dm7, Cmaj7 (major) / Dm7, Bbmaj7, Gm7, Am7 (minor)
  function _getChordNotes(tone) {
    return tone === 1
      ? [['f3', 'a3', 'c4', 'e4'], ['e3', 'g3', 'b3', 'd4'],
         ['d3', 'f3', 'a3', 'c4'], ['c3', 'e3', 'g3', 'b3']]
      : [['d3', 'f3', 'a3', 'c4'], ['bb2', 'd3', 'f3', 'a3'],
         ['g2', 'bb2', 'd3', 'f3'], ['a2', 'c3', 'e3', 'g3']];
  }

  // Convert strudel note back to standard for noteToMidi
  function _strudelToStd(n) {
    return n.replace('s', '#').replace(/^(.)/, c => c.toUpperCase());
  }

  return {
    name: 'just_vibes',
    label: 'Just Vibes',
    category: 'music',

    init() {
      chordIdx = 0;
      lastSpikeAt = 0;
    },

    pattern(data) {
      const h = data.heat || 0.3;
      const pr = data.price || 0.5;
      const v = data.velocity || 0.1;
      const tr = data.trade_rate || 0.2;
      const t = data.tone !== undefined ? data.tone : 1;
      const pd = data.price_delta || 0;

      chordIdx = (chordIdx + 1) % 4;
      const roots = _getRoots(t);
      const rootNote = roots[chordIdx];
      const chords = _getChordNotes(t);
      const chord = chords[chordIdx];

      const layers = [];

      // ── Vinyl dust ──
      // Sonic Pi: :vinyl_hiss, amp: 0.05 * 5.0, rate: 0.7, every 8 beats
      layers.push(
        s('vinyl_hiss')
          .speed(0.7)
          .gain(0.05 * 5.0)
          .slow(2)
      );

      // ── Kick ──
      // Sonic Pi: :bd_fat, amp: (0.18 + h*0.1) * 1.59, cutoff: 60, rate: 0.8
      // Beats 1 and 3, ghost at beat 1.5 if tr > 0.4 && rand < 0.25
      const kickAmpVal = (0.18 + h * 0.1) * 1.59;
      layers.push(
        s('bd_fat')
          .speed(0.8)
          .lpf(midiToHz(60))
          .gain(kickAmpVal)
          .struct('t ~ t ~')  // beats 1 and 3
      );
      // Beat 3 slightly quieter: * 0.9
      if (tr > 0.4 && Math.random() < 0.25) {
        layers.push(
          s('bd_fat')
            .speed(0.75)
            .lpf(midiToHz(50))
            .gain(kickAmpVal * 0.25)
            .struct('~ t ~ ~').slow(2)  // rare ghost
        );
      }

      // ── Snare ──
      // Sonic Pi: :sn_dub, amp: (0.06 + h*0.04) * 0.77, rate: 0.85, finish: 0.25
      // Offset 2 beats, reverb room: 0.85
      const snareAmp = (0.06 + h * 0.04) * 0.77;
      layers.push(
        s('sn_dub')
          .speed(0.85)
          .end(0.25)
          .gain(snareAmp)
          .room(0.55).rsize(2.8)
          .struct('~ t ~ ~')  // beat 2
      );
      // Ghost snare: 15% chance
      if (Math.random() < 0.15) {
        layers.push(
          s('sn_dub')
            .speed(0.9)
            .end(0.15)
            .gain(0.025 * 0.77)
            .room(0.65).rsize(3)
            .struct('~ ~ ~ t').slow(2)
        );
      }

      // ── Hi-hats ──
      // Sonic Pi: :drum_cymbal_closed, amp: rrand(0.015,0.04) * 2.2
      // rate: rrand(1.3,1.7), finish: 0.04, hpf: 105, probabilistic
      const hatProb = 0.12 + tr * 0.35;
      if (hatProb > 0.15) {
        layers.push(
          s('drum_cymbal_closed')
            .speed(rand.range(1.3, 1.7))
            .end(0.04)
            .gain(rand.range(0.015, 0.04).mul(2.2))
            .hpf(midiToHz(105))
            .pan(rand.range(0.2, 0.8))
            .fast(tr > 0.5 ? 4 : 2)
            .degradeBy(1 - hatProb)
        );
      }

      // ── Rim (cowbell tick) ──
      // Sonic Pi: :drum_cowbell, amp: 0.02 * 0.52, rate: 2.8, finish: 0.03
      // 16-step pattern
      if (tr > 0.2) {
        layers.push(
          s('drum_cowbell')
            .speed(2.8)
            .end(0.03)
            .gain(0.02 * 0.52)
            .pan(sine.range(0.4, 0.6).slow(4))
            .struct('~ ~ ~ t ~ ~ t ~ ~ ~ ~ t ~ t ~ ~')
            .fast(4)
        );
      }

      // ── Sub bass ──
      // Sonic Pi: :sine, amp: (0.14 + h*0.06) * 0.23 * 0.39, cutoff: 50
      const subAmpVal = (0.14 + h * 0.06) * 0.23 * 0.39;
      layers.push(
        note(rootNote)
          .s('sine')
          .gain(subAmpVal)
          .lpf(midiToHz(50))
          .attack(0.15).decay(0.1).sustain(0.8).release(0.8)
      );

      // ── Bass line ──
      // Sonic Pi: :tb303, cutoff: 42 + pr*18, res: 0.12
      // amp: (0.05 + h*0.03) * rrand(0.8,1.0) * 0.6 * 0.59
      const bassAmpVal = (0.05 + h * 0.03) * 0.6 * 0.59;
      const bassCut = 42 + pr * 18 + 10;  // +10 for outer LPF
      const rootMidi = noteToMidi(_strudelToStd(rootNote));
      const bassNotes = _buildBassPhrase(rootMidi, bassAmpVal);
      if (bassNotes) {
        layers.push(
          bassNotes
            .s('sawtooth')
            .lpf(midiToHz(bassCut))
            .lpq(3.6)  // res: 0.12 mapped
            .attack(0.01).decay(0.25).sustain(0).release(0.1)
        );
      }

      // ── Pad wash (hollow) ──
      // Sonic Pi: :hollow, lofi_chords[idx], amp: [0.045 - h*0.02, 0.012].max * 2.66 * 2.15
      // reverb 0.92, lpf: 58 + pr*18
      const padAmpVal = Math.max(0.012, 0.045 - h * 0.02) * 2.66 * 2.15;
      const padCut = 58 + pr * 18;
      const padNote = _choose(chord);
      layers.push(
        note(padNote)
          .s('triangle')
          .gain(padAmpVal)
          .lpf(midiToHz(padCut))
          .attack(2.5).decay(1).sustain(0.5).release(5)
          .room(0.7).rsize(5)
          .slow(_choose([6, 8]) / 4)
      );

      // ── Deep echo ──
      // Sonic Pi: :dark_ambience, root+24, amp: (0.025 + v*0.025) * 5.0 * 5.0
      // echo phase: 1.0, decay: 8, lpf: 65
      if (v > 0.25) {
        const deepRoot = _choose(roots);
        const deepMidi = noteToMidi(_strudelToStd(deepRoot)) + 24;
        const deepNote = noteToStrudel(midiToNote(deepMidi));
        const deepAmp = (0.025 + v * 0.025) * 5.0 * 5.0;
        layers.push(
          note(deepNote)
            .s('sawtooth')
            .gain(deepAmp)
            .lpf(midiToHz(65))
            .attack(1.5).decay(0.5).sustain(0.3).release(4)
            .delay(0.5).delaytime(1.0).delayfeedback(0.35)
            .slow(_choose([10, 12, 14]) / 4)
        );
      }

      // ── Price drift ──
      // Sonic Pi: :piano, scale(:f4/:d4, :major_pentatonic/:minor_pentatonic)
      // amp: vol * rrand(0.6,1.0) * 0.97 * 0.95, hard: 0.12, vel: 0.25+rrand
      const mag = Math.abs(pd);
      if (mag > 0.2) {
        const scaleRoot = t === 1 ? 'F4' : 'D4';
        const scaleType = t === 1 ? 'major_pentatonic' : 'minor_pentatonic';
        const sc = getScaleNotes(scaleRoot, scaleType, 20, 2);
        const num = Math.min(Math.max(2 + Math.floor(mag * 5), 2), 5);
        const driftVol = Math.min(Math.max(0.04 + mag * 0.1, 0.04), 0.11);
        let driftNotes = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        const driftStr = driftNotes.map(n => noteToStrudel(n)).join(' ');
        layers.push(
          note(driftStr)
            .s('fm').fmi(0.6).fmh(2).fmdecay(0.08)
            .gain(driftVol * 0.97 * 0.95)
            .attack(0.003).decay(0.35).sustain(0.05).release(1.0)
            .room(0.75).rsize(4)
            .lpf(midiToHz(82))
        );
      }

      // ── Ambient drone ──
      // Sonic Pi: :dark_ambience, [:f2,:c3,:f3].choose
      // amp: 0.06 * 5.0 * 5.0, reverb 0.95, lpf: 58
      if (data.ambient_mode === 1) {
        const droneNote = _choose(['f2', 'c3', 'f3']);
        layers.push(
          note(droneNote)
            .s('sawtooth')
            .gain(0.06 * 5.0 * 5.0)
            .lpf(midiToHz(58))
            .attack(4).decay(0.5).sustain(0.3).release(8)
            .room(0.85).rsize(6)
            .slow(2)
        );
      }

      // Stack all layers at 75 BPM
      return stack(...layers).cpm(75 / 4);
    },

    onEvent(type, msg, data) {
      const t = data.tone !== undefined ? data.tone : 1;

      if (type === 'spike') {
        // Sonic Pi: :drum_cymbal_soft, amp: 0.06 * 1.87, rate: 0.45, reverb 0.85
        const now = Date.now();
        if (now - lastSpikeAt < SPIKE_COOLDOWN) return null;
        lastSpikeAt = now;
        return s('drum_cymbal_soft')
          .speed(0.45)
          .gain(0.06 * 1.87)
          .room(0.65).rsize(2.8);
      }

      if (type === 'price_move') {
        // Sonic Pi: :piano, scale(:f4/:d4, :major/:minor), 7 notes
        // hard: 0.12, vel: 0.3+rrand, reverb 0.92, echo 0.75/6, lpf: 85
        const dir = msg.direction || 1;
        const scaleRoot = t === 1 ? 'F4' : 'D4';
        const scaleType = t === 1 ? 'major' : 'minor';
        const sc = getScaleNotes(scaleRoot, scaleType, 7, 2);
        const ns = dir > 0 ? sc : sc.slice().reverse();
        const noteStr = ns.map(n => noteToStrudel(n)).join(' ');
        return note(noteStr)
          .s('fm').fmi(0.6).fmh(2).fmdecay(0.08)
          .gain(0.09 * 0.97 * 0.95)
          .attack(0.003).decay(0.35).sustain(0.05).release(1.0)
          .delay(0.45).delaytime(0.75).delayfeedback(0.3)
          .room(0.8).rsize(5)
          .lpf(midiToHz(85));
      }

      if (type === 'resolved') {
        // Sonic Pi: :piano, scale(:f4/:d4), hard: 0.12+frac*0.12, vel: 0.3
        const result = msg.result || 1;
        const scaleRoot = result === 1 ? 'F4' : 'D4';
        const scaleType = result === 1 ? 'major' : 'minor';
        let sc = getScaleNotes(scaleRoot, scaleType, 8, 1);
        if (result !== 1) sc = sc.reverse();
        const noteStr = sc.map(n => noteToStrudel(n)).join(' ');
        return note(noteStr)
          .s('fm').fmi(0.6).fmh(2).fmdecay(0.08)
          .gain(0.09 * 0.97 * 0.95)
          .attack(0.003).decay(0.35).sustain(0.05).release(1.0)
          .delay(0.4).delaytime(0.5).delayfeedback(0.3)
          .room(0.8).rsize(5);
      }

      return null;
    },
  };

  function _buildBassPhrase(rootMidi, ampVal) {
    // Sonic Pi: 4 tb303 phrase patterns, randomly chosen
    const r = rootMidi;
    const phrases = [
      [r, 1.5, null, 0.5, r+7, 0.5, null, 0.5, r, 0.5],
      [null, 0.5, r, 1.0, r+5, 0.5, null, 0.5, r, 1.5],
      [r, 1.0, null, 0.5, r+7, 0.5, r+5, 0.5, null, 0.5, r, 0.5, null, 0.5],
      [r, 0.5, null, 1.0, r+3, 0.5, r, 1.0, null, 1.0],
    ];
    const phrase = _choose(phrases);

    const noteArr = [];
    for (let i = 0; i < phrase.length; i += 2) {
      const n = phrase[i];
      if (n === null) {
        noteArr.push('~');
      } else {
        noteArr.push(noteToStrudel(midiToNote(n)));
      }
    }
    return note(noteArr.join(' ')).gain(ampVal);
  }
})();

audioEngine.registerTrack('just_vibes', justVibesTrack);
