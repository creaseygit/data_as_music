// ── Mezzanine Track (Strudel) ────────────────────────────
// Massive Attack / Teardrop-inspired ambient dub.
// Am -> Am -> F -> G progression, 80 BPM.
// Ported from sonic_pi/mezzanine.rb (the original).
// category: 'music', label: 'Mezzanine'
//
// Sonic Pi synth mapping:
//   :piano  → s('fm') with low fmi, fast fmdecay (hammer strike character)
//   :tb303  → s('sawtooth') with lpf/lpq (resonant acid bass)
//   :pluck  → s('triangle') with short decay + room (Karplus-Strong approx)
//   :hollow → s('triangle') with bandpass-like lpf + high room (breathy pad)
//   :dark_ambience → s('sawtooth') with heavy lpf + room (detuned dark pad)
//   :sine   → s('sine')
//
// Amp values taken from the mastered Sonic Pi source (with ~nf factors applied).

const mezzanineTrack = (() => {
  let chordIdx = 0;
  let bassPhraseTick = 0;
  let lastSpikeAt = 0;
  const SPIKE_COOLDOWN = 15000;

  function _rrand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function _choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Sonic Pi: chord_root cycles Am(4bars) -> F(2bars) -> G(2bars)
  function _chordRootMidi() {
    const idx = chordIdx % 8;
    if (idx < 4) return 45; // A2
    if (idx < 6) return 41; // F2
    return 43; // G2
  }

  // Sonic Pi arp_notes: depends on chord position and tone
  function _arpNotes(tone) {
    const idx = chordIdx % 8;
    if (idx < 4) {
      return tone === 1
        ? ['a4', 'c5', 'e5', 'c5', 'a4', 'c5']
        : ['a4', 'c5', 'e5', 'c5', 'gs4', 'c5'];
    } else if (idx < 6) {
      return ['f4', 'a4', 'c5', 'a4', 'f4', 'a4'];
    } else {
      return ['g4', 'b4', 'd5', 'b4', 'g4', 'b4'];
    }
  }

  // Convert strudel note (e.g. 'gs4') back to standard (e.g. 'G#4') for noteToMidi
  function _strudelToStd(n) {
    return n.replace('s', '#').replace(/^(.)/, c => c.toUpperCase());
  }

  return {
    name: 'mezzanine',
    label: 'Mezzanine',
    category: 'music',

    init() {
      chordIdx = 0;
      bassPhraseTick = 0;
      lastSpikeAt = 0;
    },

    pattern(data) {
      const h = data.heat || 0.3;
      const pr = data.price || 0.5;
      const v = data.velocity || 0.1;
      const tr = data.trade_rate || 0.2;
      const t = data.tone !== undefined ? data.tone : 1;
      const pd = data.price_delta || 0;

      // Advance chord each pattern cycle
      chordIdx = (chordIdx + 1) % 8;
      const root = _chordRootMidi();
      const rootNote = noteToStrudel(midiToNote(root));

      const layers = [];

      // ── Sub bass ──
      // Sonic Pi: :sine, amp: (0.16 + h*0.1) * 0.23, cutoff: 55, attack: 0.2, sustain: 3, release: 0.8
      const subAmpVal = 0.16 + h * 0.1;
      layers.push(
        note(rootNote)
          .s('sine')
          .gain(subAmpVal * 0.23)
          .lpf(midiToHz(55))
          .attack(0.2).decay(0.1).sustain(0.9).release(0.8)
      );

      // ── Bass line ──
      // Sonic Pi: :tb303, cutoff: 48 + pr*25, res: 0.2, wave: 0 (saw)
      // amp: (0.06 + h*0.05) * rrand(0.8,1.0) * 0.6
      const bassAmpVal = 0.06 + h * 0.05;
      const bassCut = 48 + pr * 25;
      const bassNotes = _buildBassPhrase(root, bassAmpVal);
      if (bassNotes) {
        layers.push(
          bassNotes
            .s('sawtooth')
            .lpf(midiToHz(bassCut))
            .lpq(5)  // res: 0.2 mapped to moderate Q
            .attack(0.01).decay(0.3).sustain(0).release(0.1)
        );
      }

      // ── Teardrop arp ──
      // Sonic Pi: :pluck, coeff: rrand(0.1, 0.2), reverb room: 0.8, lpf: 75 + pr*15
      // amp: [0.04 - h*0.015, 0.015].max * rrand(0.6, 1.0) * 1.86
      if (!(h > 0.75 && Math.random() < 0.6)) {
        const arpAmpVal = Math.max(0.015, 0.04 - h * 0.015);
        const arpCut = 75 + pr * 15;
        const arpNs = _arpNotes(t);

        // Build arp with occasional octave jumps and ghost notes
        const arpNotesArr = [];
        arpNs.forEach(n => {
          if (Math.random() < 0.12) {
            arpNotesArr.push('~'); // rest (skip)
          } else {
            let oct = (v > 0.4 && Math.random() < v * 0.4) ? 12 : 0;
            if (oct > 0) {
              const midi = noteToMidi(_strudelToStd(n)) + 12;
              arpNotesArr.push(noteToStrudel(midiToNote(midi)));
            } else {
              arpNotesArr.push(n);
            }
          }
        });
        const arpStr = arpNotesArr.join(' ');
        layers.push(
          note(arpStr)
            .s('triangle')
            .gain(arpAmpVal * 1.86)
            .lpf(midiToHz(arpCut))
            .attack(0.001).decay(0.15).sustain(0.05).release(1.5)
            .room(0.6).rsize(4).roomlp(3000)
        );
      }

      // ── Kick ──
      // Sonic Pi: :bd_fat, amp: (0.2 + h*0.15) * 1.6, cutoff: 70, rate: 0.85
      // Every 2 beats, ghost at 0.75 if tr > 0.4
      const kickAmpVal = (0.2 + h * 0.15) * 1.6;
      layers.push(
        s('bd_fat')
          .speed(0.85)
          .lpf(midiToHz(70))
          .gain(kickAmpVal)
          .struct('t ~ t ~')  // beats 1 and 3 (every 2 beats in 4-beat cycle)
      );
      if (tr > 0.4) {
        layers.push(
          s('bd_fat')
            .speed(0.8)
            .lpf(midiToHz(60))
            .gain(kickAmpVal * 0.4)
            .struct('~ t ~ ~')  // ghost on beat 2
        );
      }

      // ── Kick ghost pattern ──
      // Sonic Pi: ring(0,0,1,0,0,1,0,0) on 8th notes, cutoff: 55, rate: 0.75
      // amp: (0.06 + h*0.05) * 1.6
      if (tr > 0.3) {
        const ghostAmp = (0.06 + h * 0.05) * 1.6;
        layers.push(
          s('bd_fat')
            .speed(0.75)
            .lpf(midiToHz(55))
            .gain(ghostAmp)
            .struct('~ ~ t ~ ~ t ~ ~')
            .fast(2)
        );
      }

      // ── Snare dub ──
      // Sonic Pi: :sn_dub, amp: (0.08 + h*0.07) * 0.78, rate: 0.9, finish: 0.3
      // Offset 2 beats, reverb room: 0.8
      const snareAmp = (0.08 + h * 0.07) * 0.78;
      layers.push(
        s('sn_dub')
          .speed(0.9)
          .end(0.3)
          .gain(snareAmp)
          .room(0.5).rsize(2.5).roomlp(2500)
          .struct('~ ~ t ~')  // beat 3 (offset 2)
      );
      // Ghost snare
      if (tr > 0.5 && Math.random() < 0.4) {
        layers.push(
          s('sn_dub')
            .speed(1.0)
            .end(0.2)
            .gain(0.05 * 0.78)
            .room(0.6).rsize(3)
            .struct('~ ~ ~ t').slow(2)
        );
      }

      // ── Rim (cowbell tick) ──
      // Sonic Pi: :drum_cowbell, amp: (0.03 + h*0.03) * 0.52, rate: 2.5, finish: 0.04
      // 16-step pattern on 16th notes
      if (tr > 0.25) {
        const rimAmp = (0.03 + h * 0.03) * 0.52;
        layers.push(
          s('drum_cowbell')
            .speed(2.5)
            .end(0.04)
            .gain(rimAmp)
            .pan(sine.range(0.35, 0.65).slow(4))
            .struct('~ ~ ~ t ~ ~ t ~ ~ ~ t ~ ~ t ~ ~')
            .fast(4)
        );
      }

      // ── Hi-hat ghost ──
      // Sonic Pi: :drum_cymbal_closed, amp: rrand(0.02,0.06) * 2.48,
      // rate: rrand(1.2,1.8), finish: 0.05, hpf: 110, probabilistic
      const hatProb = 0.1 + tr * 0.35;
      if (hatProb > 0.15) {
        layers.push(
          s('drum_cymbal_closed')
            .speed(rand.range(1.2, 1.8))
            .end(0.05)
            .gain(rand.range(0.02, 0.06).mul(2.48))
            .hpf(midiToHz(110))
            .pan(rand.range(0.1, 0.9))
            .fast(tr > 0.6 ? 4 : 2)
            .degradeBy(1 - hatProb)
        );
      }

      // ── Vinyl dust ──
      // Sonic Pi: :vinyl_hiss, amp: 0.045 * 5.0, rate: 0.8, every 8 beats
      layers.push(
        s('vinyl_hiss')
          .speed(0.8)
          .gain(0.045 * 5.0)
          .slow(2)
      );

      // ── Dub wash (hollow pad) ──
      // Sonic Pi: :hollow, chord(:a3, :minor7 or :m7minus5).choose
      // amp: [0.05 - h*0.025, 0.015].max * 2.66
      // reverb room: 0.95, lpf: 55 + pr*20
      const padAmpVal = Math.max(0.015, 0.05 - h * 0.025) * 2.66;
      const padCut = 55 + pr * 20;
      // minor7 = [0, 3, 7, 10], m7minus5 = [0, 3, 6, 10] from root A3 (MIDI 57)
      const padIntervals = t === 1 ? [0, 3, 7, 10] : [0, 3, 6, 10];
      const padMidi = 57 + _choose(padIntervals);
      const padNote = noteToStrudel(midiToNote(padMidi));
      layers.push(
        note(padNote)
          .s('triangle')
          .gain(padAmpVal)
          .lpf(midiToHz(padCut))
          .attack(3).decay(1).sustain(0.6).release(5)
          .room(0.75).rsize(6)
          .slow(_choose([6, 8]) / 4)
      );

      // ── Deep echo ──
      // Sonic Pi: :dark_ambience, [:a3,:c4,:e4] or [:a3,:c4,:gs3]
      // amp: (0.03 + v*0.03) * 5.0, echo phase: 0.75, decay: 6, lpf: 70
      if (v > 0.3) {
        const deepNotes = t === 1
          ? ['a3', 'c4', 'e4']
          : ['a3', 'c4', 'gs3'];
        const deepNote = _choose(deepNotes);
        const deepAmp = (0.03 + v * 0.03) * 5.0;
        layers.push(
          note(deepNote)
            .s('sawtooth')
            .gain(deepAmp)
            .lpf(midiToHz(70))
            .attack(1).decay(0.5).sustain(0.3).release(3)
            .delay(0.6).delaytime(0.75).delayfeedback(0.5)
            .room(0.5).rsize(4)
            .slow(_choose([8, 10, 12]) / 4)
        );
      }

      // ── Price drift ──
      // Sonic Pi: :pluck, scale(:a4, :minor_pentatonic), coeff: 0.2
      // amp: vol * rrand(0.6,1.0) * 1.86, reverb 0.9, echo 0.5/5, lpf: 85
      const mag = Math.abs(pd);
      if (mag > 0.2) {
        const sc = getScaleNotes('A4', 'minor_pentatonic', 14, 2);
        const num = Math.min(6, Math.max(2, 2 + Math.floor(mag * 6)));
        const driftVol = Math.min(0.14, Math.max(0.04, 0.04 + mag * 0.12));
        let driftNotes = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        const driftStr = driftNotes.map(n => noteToStrudel(n)).join(' ');
        layers.push(
          note(driftStr)
            .s('triangle')
            .gain(driftVol * 1.86)
            .lpf(midiToHz(85))
            .attack(0.001).decay(0.2).sustain(0.05).release(2.0)
            .delay(0.5).delaytime(0.5).delayfeedback(0.45)
            .room(0.75).rsize(5)
        );
      }

      // ── Ambient drone ──
      // Sonic Pi: :dark_ambience, [:a2,:e3,:a3].choose
      // amp: 0.08 * 5.0, reverb 0.95, lpf: 60
      if (data.ambient_mode === 1) {
        const droneNote = _choose(['a2', 'e3', 'a3']);
        layers.push(
          note(droneNote)
            .s('sawtooth')
            .gain(0.08 * 5.0)
            .lpf(midiToHz(60))
            .attack(4).decay(1).sustain(0.5).release(8)
            .room(0.85).rsize(6)
            .slow(2)
        );
      }

      // Stack all layers at 80 BPM
      return stack(...layers).cpm(80 / 4);
    },

    onEvent(type, msg, data) {
      const t = data.tone !== undefined ? data.tone : 1;
      const pd = data.price_delta || 0;
      const mag = Math.abs(pd);

      if (type === 'spike') {
        // Sonic Pi: :drum_cymbal_soft, amp: 0.08 * 1.88, rate: 0.5, reverb 0.8
        const now = Date.now();
        if (now - lastSpikeAt < SPIKE_COOLDOWN) return null;
        lastSpikeAt = now;
        return s('drum_cymbal_soft')
          .speed(0.5)
          .gain(0.08 * 1.88)
          .room(0.6).rsize(3);
      }

      if (type === 'price_move') {
        // Sonic Pi: :piano, scale(:a4, :minor), hard: 0.15, vel: 0.3+rrand
        // amp: vol * (0.5 + frac*0.3) * rrand(0.7,1.0) * 0.97
        // reverb 0.92, echo 0.75/6, lpf: 90
        const dir = msg.direction || 1;
        const sc = getScaleNotes('A4', 'minor', 14, 2);
        const num = Math.min(7, Math.max(3, 3 + Math.floor(mag * 7)));
        const vol = Math.min(0.1, Math.max(0.04, 0.04 + mag * 0.12));
        const ns = dir > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();
        const noteStr = ns.map(n => noteToStrudel(n)).join(' ');
        return note(noteStr)
          .s('fm').fmi(0.8).fmh(2).fmdecay(0.1)
          .gain(vol * 0.97)
          .attack(0.003).decay(0.4).sustain(0.05).release(1.5)
          .delay(0.5).delaytime(0.75).delayfeedback(0.5)
          .room(0.8).rsize(4)
          .lpf(midiToHz(90));
      }

      if (type === 'resolved') {
        // Sonic Pi: :piano, scale(:a4, :major/minor), hard: 0.15, vel: 0.35
        // amp: 0.1 * (0.5 + frac*0.5) * 0.97
        const result = msg.result || 1;
        const sc = result === 1
          ? getScaleNotes('A4', 'major', 8, 1)
          : getScaleNotes('A4', 'minor', 8, 1).reverse();
        const noteStr = sc.map(n => noteToStrudel(n)).join(' ');
        return note(noteStr)
          .s('fm').fmi(0.8).fmh(2).fmdecay(0.1)
          .gain(0.1 * 0.97)
          .attack(0.003).decay(0.4).sustain(0.05).release(1.5)
          .delay(0.4).delaytime(0.5).delayfeedback(0.4)
          .room(0.8).rsize(5);
      }

      return null;
    },
  };

  function _buildBassPhrase(rootMidi, ampVal) {
    // Sonic Pi: 4 phrase patterns with note/duration pairs
    const r = rootMidi;
    const phrases = [
      [r, 1.5, null, 0.5, r+7, 0.5, r+5, 0.5, r, 1.0],
      [null, 0.5, r, 1.0, r+3, 0.5, r+5, 1.0, null, 1.0],
      [r, 1.0, r+5, 0.5, r+3, 0.5, null, 0.5, r+7, 0.5, r, 0.5, null, 0.5],
      [r+7, 0.5, r+5, 0.5, null, 1.0, r, 1.0, r+3, 1.0],
    ];
    const phrase = phrases[bassPhraseTick % phrases.length];
    bassPhraseTick++;

    // Build mini-notation string from note/duration pairs
    const noteArr = [];
    for (let i = 0; i < phrase.length; i += 2) {
      const n = phrase[i];
      const dur = phrase[i + 1];
      // Use @weight for relative durations in mini-notation
      if (n === null) {
        noteArr.push('~');
      } else {
        noteArr.push(noteToStrudel(midiToNote(n)));
      }
    }
    const noteStr = noteArr.join(' ');
    return note(noteStr).gain(ampVal * 0.6);  // Sonic Pi: * rrand(0.8,1.0) * 0.6
  }
})();

audioEngine.registerTrack('mezzanine', mezzanineTrack);
