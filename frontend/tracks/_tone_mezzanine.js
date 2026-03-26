// ── Mezzanine Track ──────────────────────────────────────
// Massive Attack / Teardrop-inspired ambient dub.
// Am -> Am -> F -> G progression, 80 BPM.
// Faithful port of sonic_pi/mezzanine.rb
// category: 'music', label: 'Mezzanine'

class MezzanineTrack {
  constructor(destination) {
    this.dest = destination;
    this.data = {
      heat: 0.3, price: 0.5, velocity: 0.1, trade_rate: 0.2,
      spread: 0.2, tone: 1, price_delta: 0, ambient_mode: 0,
    };
    this.chordIdx = 0;
    this.spikeCooldown = 15000; // ms
    this.lastSpikeAt = 0;
    this.disposed = false;
    this.samplesReady = false;

    // Preload all required samples
    const sampleNames = [
      'bd_fat', 'sn_dub', 'drum_cymbal_closed',
      'drum_cowbell', 'vinyl_hiss', 'drum_cymbal_soft',
    ];
    sampleBank.preload(sampleNames).then(() => {
      if (this.disposed) return;
      this.samplesReady = true;
    });

    // ── Sub bass (sine + LPF cutoff 55 = midiToHz(55)) ──
    this.subFilter = new Tone.Filter({
      frequency: midiToHz(55), type: 'lowpass',
    }).connect(destination);
    this.subSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.2, decay: 0.1, sustain: 0.9, release: 0.8 },
    }).connect(this.subFilter);

    // ── Bass line (tb303 style: sawtooth + filter envelope + resonance) ──
    this.bassFilter = new Tone.Filter({
      frequency: midiToHz(48), type: 'lowpass', Q: 3,
    }).connect(destination);
    this.bassSynth = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 4, rolloff: -24 },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.1 },
      filterEnvelope: {
        attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.1,
        baseFrequency: 200, octaves: 2,
      },
    }).connect(this.bassFilter);

    // ── Arp (pluck with reverb(0.8) -> lpf) ──
    this.arpReverb = new Tone.Reverb({ decay: 4, wet: 0.6 }).connect(destination);
    this.arpFilter = new Tone.Filter({
      frequency: midiToHz(75), type: 'lowpass',
    }).connect(this.arpReverb);
    this.arpSynth = new Tone.PluckSynth({
      resonance: 0.92,    // high resonance = long ring, matching Sonic Pi coeff 0.1-0.2
      release: 1.5,
    }).connect(this.arpFilter);

    // ── Snare reverb chain ──
    this.snareReverb = new Tone.Reverb({ decay: 2.5, wet: 0.5 }).connect(destination);
    this.snareGhostReverb = new Tone.Reverb({ decay: 3, wet: 0.6 }).connect(destination);

    // ── Hat HPF (cutoff 110 = midiToHz(110)) ──
    this.hatFilter = new Tone.Filter({
      frequency: midiToHz(110), type: 'highpass',
    }).connect(destination);

    // ── Kick LPF chains (Sonic Pi cutoff on samples) ──
    this.kickFilter = new Tone.Filter({
      frequency: midiToHz(70), type: 'lowpass',
    }).connect(destination);
    this.kickGhostFilter = new Tone.Filter({
      frequency: midiToHz(60), type: 'lowpass',
    }).connect(destination);
    this.kickPatternFilter = new Tone.Filter({
      frequency: midiToHz(55), type: 'lowpass',
    }).connect(destination);

    // ── Pad / dub wash ──
    // Sonic Pi :hollow is a band-pass filtered noise synth with resonance.
    // Approximate with filtered noise layered with a quiet triangle for pitch.
    this.padReverb = new Tone.Reverb({ decay: 6, wet: 0.75 }).connect(destination);
    this.padFilter = new Tone.Filter({
      frequency: midiToHz(55), type: 'lowpass',
    }).connect(this.padReverb);
    // Use a softer oscillator blend for hollow-like breathiness
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 3, decay: 1, sustain: 0.6, release: 5 },
    }).connect(this.padFilter);
    // Noise layer for breathy :hollow character
    this.padNoiseFilter = new Tone.Filter({
      frequency: midiToHz(55), type: 'bandpass', Q: 2,
    }).connect(this.padReverb);
    this.padNoiseGain = new Tone.Gain(0).connect(this.padNoiseFilter);
    this.padNoise = new Tone.Noise('pink').connect(this.padNoiseGain);

    // ── Deep echo (dark_ambience: detuned saw pair + heavy LPF + reverb) ──
    this.deepReverb = new Tone.Reverb({ decay: 4, wet: 0.5 }).connect(destination);
    this.deepFilter = new Tone.Filter({
      frequency: midiToHz(70), type: 'lowpass',
    }).connect(this.deepReverb);
    this.deepDelay = new Tone.FeedbackDelay({
      delayTime: 0.75, feedback: 0.5, wet: 0.6,
    }).connect(this.deepFilter);
    this.deepSynth = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', spread: 20, count: 3 },
      envelope: { attack: 1, decay: 0.5, sustain: 0.3, release: 3 },
    }).connect(this.deepDelay);

    // ── Price drift chain: pluck -> reverb(0.9) -> echo(0.5, decay:5) -> lpf(85) ──
    this.driftFilter = new Tone.Filter({
      frequency: midiToHz(85), type: 'lowpass',
    }).connect(destination);
    this.driftDelay = new Tone.FeedbackDelay({
      delayTime: 0.5, feedback: 0.45, wet: 0.5,
    }).connect(this.driftFilter);
    this.driftReverb = new Tone.Reverb({ decay: 5, wet: 0.75 }).connect(this.driftDelay);
    this.driftSynth = new Tone.PluckSynth({
      resonance: 0.85, release: 3,
    }).connect(this.driftReverb);

    // ── Event move chain: piano -> reverb(0.92) -> echo(0.75, decay:6) -> lpf(90) ──
    this.moveFilter = new Tone.Filter({
      frequency: midiToHz(90), type: 'lowpass',
    }).connect(destination);
    this.moveDelay = new Tone.FeedbackDelay({
      delayTime: 0.75, feedback: 0.5, wet: 0.5,
    }).connect(this.moveFilter);
    this.moveReverb = new Tone.Reverb({ decay: 4, wet: 0.8 }).connect(this.moveDelay);
    this.pianoSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 1.5,
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 1.5 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.5 },
    }).connect(this.moveReverb);

    // ── Spike cymbal: reverb(0.8) -> out ──
    this.spikeReverb = new Tone.Reverb({ decay: 3, wet: 0.6 }).connect(destination);

    // ── Ambient drone (dark_ambience: detuned saw + reverb(0.95) + lpf(60)) ──
    this.droneFilter = new Tone.Filter({
      frequency: midiToHz(60), type: 'lowpass',
    }).connect(destination);
    this.droneReverb = new Tone.Reverb({ decay: 6, wet: 0.85 }).connect(this.droneFilter);
    this.droneSynth = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', spread: 20, count: 3 },
      envelope: { attack: 4, decay: 1, sustain: 0.5, release: 8 },
    }).connect(this.droneReverb);

    // ── Resolved chain: piano -> reverb(0.95) -> echo(0.5, decay:6) ──
    this.resolvedFilter = new Tone.Filter({
      frequency: 3000, type: 'lowpass',
    }).connect(destination);
    this.resolvedDelay = new Tone.FeedbackDelay({
      delayTime: 0.5, feedback: 0.4, wet: 0.4,
    }).connect(this.resolvedFilter);
    this.resolvedReverb = new Tone.Reverb({ decay: 5, wet: 0.8 }).connect(this.resolvedDelay);
    this.resolvedSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 1.5,
      envelope: { attack: 0.01, decay: 0.4, sustain: 0.1, release: 1.5 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.5 },
    }).connect(this.resolvedReverb);

    // ── Timing state ──
    this.bassPhraseTick = 0;
    this.kickGhostTick = 0;
    this.rimTick = 0;

    // ── Build Transport loops ──
    this._buildLoops();
  }

  /**
   * Play a sample with Sonic Pi-compatible parameters.
   * @param {string} name - Sample name (e.g. 'bd_fat')
   * @param {number} time - Tone.js scheduled time
   * @param {object} opts - Options:
   *   amp: volume (default 1)
   *   playbackRate: speed (default 1)
   *   finish: 0-1, portion of sample to play (Sonic Pi finish:)
   *   destination: Tone.js node to connect to (default: this.dest)
   *   pan: -1 to 1 stereo position
   */
  _playSample(name, time, opts = {}) {
    if (!this.samplesReady || this.disposed) return;

    sampleBank.load(name).then((buf) => {
      if (this.disposed) return;

      const p = new Tone.Player(buf);

      if (opts.playbackRate !== undefined) {
        p.playbackRate = opts.playbackRate;
      }

      // Build signal chain: player -> [gain] -> [panner] -> destination
      const dest = opts.destination || this.dest;
      let tail = dest;

      // Panning (Sonic Pi pan: parameter)
      let panner = null;
      if (opts.pan !== undefined) {
        panner = new Tone.Panner(opts.pan).connect(tail);
        tail = panner;
      }

      // Gain for amplitude control
      const amp = opts.amp !== undefined ? opts.amp : 1;
      const gain = new Tone.Gain(amp).connect(tail);
      p.connect(gain);

      try {
        p.start(time);

        // Sonic Pi finish: parameter — stop playback after finish fraction of sample
        const rate = opts.playbackRate || 1;
        const fullDur = buf.duration / rate;
        const finishDur = opts.finish !== undefined
          ? fullDur * opts.finish
          : fullDur;

        // Schedule stop at the finish point
        if (opts.finish !== undefined) {
          Tone.Transport.scheduleOnce(() => {
            try { p.stop(); } catch (e) {}
          }, time + finishDur);
        }

        // Dispose after full decay
        const disposeDur = (finishDur + 1.5) * 1000;
        setTimeout(() => {
          try { p.stop(); } catch (e) {}
          try { p.dispose(); } catch (e) {}
          try { gain.dispose(); } catch (e) {}
          if (panner) try { panner.dispose(); } catch (e) {}
        }, disposeDur);
      } catch (e) {}
    });
  }

  _rrand(lo, hi) {
    return lo + Math.random() * (hi - lo);
  }

  _choose(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  _chordRootMidi() {
    const idx = this.chordIdx % 8;
    if (idx < 4) return 45; // A2
    if (idx < 6) return 41; // F2
    return 43; // G2
  }

  _arpNotes() {
    const t = this.data.tone;
    const idx = this.chordIdx % 8;
    if (idx < 4) {
      return t === 1
        ? ['A4', 'C5', 'E5', 'C5', 'A4', 'C5']
        : ['A4', 'C5', 'E5', 'C5', 'G#4', 'C5'];
    } else if (idx < 6) {
      return ['F4', 'A4', 'C5', 'A4', 'F4', 'A4'];
    } else {
      return ['G4', 'B4', 'D5', 'B4', 'G4', 'B4'];
    }
  }

  _buildLoops() {
    const self = this;
    const beatDur = 60 / 80; // 0.75s per beat at 80 BPM

    // ── Sub bass: every 4 beats ──
    this.subLoop = new Tone.Loop((time) => {
      self.chordIdx = (self.chordIdx + 1) % 8;
      const h = self.data.heat;
      const root = self._chordRootMidi();
      const amp = 0.13 + h * 0.06;
      self.subSynth.triggerAttackRelease(
        midiToNote(root), 3, time, amp
      );
    }, '1m');

    // ── Bass line: every 4 beats ──
    this.bassLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const pr = self.data.price;
      const cut = midiToHz(48 + pr * 25);
      self.bassFilter.frequency.rampTo(cut, 0.1, time);

      const idx = self.chordIdx % 8;
      const r = idx < 4 ? 45 : (idx < 6 ? 41 : 43);

      const amp = 0.10 + h * 0.08;

      const phrases = [
        [r, 1.5, null, 0.5, r + 7, 0.5, r + 5, 0.5, r, 1.0],
        [null, 0.5, r, 1.0, r + 3, 0.5, r + 5, 1.0, null, 1.0],
        [r, 1.0, r + 5, 0.5, r + 3, 0.5, null, 0.5, r + 7, 0.5, r, 0.5, null, 0.5],
        [r + 7, 0.5, r + 5, 0.5, null, 1.0, r, 1.0, r + 3, 1.0],
      ];
      const phrase = phrases[self.bassPhraseTick % phrases.length];
      self.bassPhraseTick++;

      let offset = 0;
      for (let i = 0; i < phrase.length; i += 2) {
        const n = phrase[i];
        const dur = phrase[i + 1];
        if (n !== null) {
          const noteName = midiToNote(n);
          const noteAmp = amp * self._rrand(0.8, 1.0);
          const releaseDur = Math.min(dur * 0.7 * beatDur, 0.35);
          self.bassSynth.triggerAttackRelease(
            noteName, releaseDur, time + offset * beatDur, noteAmp
          );
        }
        offset += dur;
      }
    }, '1m');

    // ── Teardrop arp: every 4 beats ──
    this.arpLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const pr = self.data.price;
      const v = self.data.velocity;
      const tr = self.data.trade_rate;

      if (h > 0.75 && Math.random() < 0.6) return;

      const amp = Math.max(0.06, 0.12 - h * 0.06);
      self.arpFilter.frequency.rampTo(midiToHz(75 + pr * 15), 0.1, time);

      const ns = self._arpNotes();

      // 0.5 beat offset (sleep 0.5 at start of Sonic Pi loop)
      let offset = 0.5 * beatDur;
      ns.forEach(n => {
        if (Math.random() < 0.12) {
          offset += self._choose([0.25, 0.5]) * beatDur;
          return;
        }
        const oct = (v > 0.4 && Math.random() < v * 0.4) ? 12 : 0;
        const midi = noteToMidi(n) + oct;
        const vel = amp * self._rrand(0.6, 1.0);
        // Sonic Pi coeff: 0.1-0.2 controls string brightness in the feedback loop.
        // In Tone.js PluckSynth, resonance controls sustain length (0-1).
        // coeff 0.1-0.2 in Sonic Pi = moderately damped but still ringing.
        // Map to resonance ~0.88-0.95 for similar ring time.
        self.arpSynth.resonance = self._rrand(0.88, 0.95);
        self.arpSynth.triggerAttack(midiToNote(midi), time + offset, vel);

        if (tr > 0.5 && Math.random() < 0.2) {
          offset += 0.25 * beatDur;
          self.arpSynth.triggerAttack(
            midiToNote(midi + 12), time + offset, vel * 0.5
          );
          offset += 0.25 * beatDur;
        } else {
          offset += (tr > 0.4
            ? self._choose([0.25, 0.5, 0.75])
            : 0.5) * beatDur;
        }
      });
    }, '1m');

    // ── Kick: every 2 beats ──
    // Sonic Pi: sample :bd_fat, cutoff: 70, rate: 0.85
    this.kickLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const tr = self.data.trade_rate;
      const amp = 0.18 + h * 0.10;

      self._playSample('bd_fat', time, {
        amp: amp,
        playbackRate: 0.85,
        destination: self.kickFilter,   // LPF cutoff: 70
      });

      // Ghost kick at 0.75 beats if trade_rate > 0.4
      // Sonic Pi: cutoff: 60, rate: 0.8
      if (tr > 0.4) {
        self._playSample('bd_fat', time + 0.75 * beatDur, {
          amp: amp * 0.35,
          playbackRate: 0.8,
          destination: self.kickGhostFilter,  // LPF cutoff: 60
        });
      }
    }, '2n');

    // ── Kick ghost: every 0.5 beats, ring pattern [0,0,1,0,0,1,0,0] ──
    // Sonic Pi: cutoff: 55, rate: 0.75
    this.kickGhostPattern = [0, 0, 1, 0, 0, 1, 0, 0];
    this.kickGhostLoop = new Tone.Loop((time) => {
      const tr = self.data.trade_rate;
      const h = self.data.heat;
      const pat = self.kickGhostPattern[self.kickGhostTick % 8];
      self.kickGhostTick++;
      if (tr > 0.3 && pat === 1) {
        self._playSample('bd_fat', time, {
          amp: 0.05 + h * 0.04,
          playbackRate: 0.75,
          destination: self.kickPatternFilter,  // LPF cutoff: 55
        });
      }
    }, '8n');

    // ── Snare dub: offset 2 beats, every 4 beats ──
    // Sonic Pi: rate: 0.9, finish: 0.3
    this.snareLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const tr = self.data.trade_rate;
      const amp = 0.08 + h * 0.07;

      self._playSample('sn_dub', time, {
        amp: amp,
        playbackRate: 0.9,
        finish: 0.3,                        // tight snare hit
        destination: self.snareReverb,
      });

      // Ghost snare: finish: 0.2 (even tighter)
      if (tr > 0.5 && Math.random() < 0.4) {
        self._playSample('sn_dub', time + 1.5 * beatDur, {
          amp: 0.04,
          playbackRate: 1.0,
          finish: 0.2,
          destination: self.snareGhostReverb,
        });
      }
    }, '1m');

    // ── Rim (cowbell): every 0.25 beats, 16-step pattern ──
    // Sonic Pi: rate: 2.5, finish: 0.04, pan: rrand(-0.2, 0.2)
    this.rimPattern = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0];
    this.rimLoop = new Tone.Loop((time) => {
      const tr = self.data.trade_rate;
      const h = self.data.heat;
      if (tr > 0.25 && self.rimPattern[self.rimTick % 16] === 1) {
        const amp = 0.03 + h * 0.03;
        self._playSample('drum_cowbell', time, {
          amp: amp,
          playbackRate: 2.5,
          finish: 0.04,                     // tiny tick, not full cowbell
          pan: self._rrand(-0.2, 0.2),
        });
      }
      self.rimTick++;
    }, '16n');

    // ── Hat ghost: probabilistic, every 0.5 or 0.25 beats ──
    // Sonic Pi: rate: rrand(1.2,1.8), finish: 0.05, pan: rrand(-0.4,0.4)
    this.hatLoop = new Tone.Loop((time) => {
      const tr = self.data.trade_rate;
      const prob = 0.1 + tr * 0.35;
      if (Math.random() < prob) {
        const amp = self._rrand(0.03, 0.07);
        self._playSample('drum_cymbal_closed', time, {
          amp: amp,
          playbackRate: self._rrand(1.2, 1.8),
          finish: 0.05,                     // crisp tick, not full cymbal
          pan: self._rrand(-0.4, 0.4),
          destination: self.hatFilter,
        });
      }
      self.hatLoop.interval = tr > 0.6 ? '16n' : '8n';
    }, '8n');

    // ── Vinyl dust: every 8 beats ──
    this.vinylLoop = new Tone.Loop((time) => {
      self._playSample('vinyl_hiss', time, {
        amp: 0.04,
        playbackRate: 0.8,
      });
    }, '2m');

    // ── Dub wash (hollow pad): every 6-8 beats ──
    this.padLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const pr = self.data.price;
      const t = self.data.tone;

      const amp = Math.max(0.05, 0.10 - h * 0.05);
      const cutFreq = midiToHz(55 + pr * 20);
      self.padFilter.frequency.rampTo(cutFreq, 0.5, time);
      // Tune the noise bandpass to follow the pad cutoff for breathy character
      self.padNoiseFilter.frequency.rampTo(cutFreq, 0.5, time);

      const ch = t === 1
        ? [noteToMidi('A3'), noteToMidi('C4'), noteToMidi('E4'), noteToMidi('G4')]
        : [noteToMidi('A3'), noteToMidi('C4'), noteToMidi('Eb4'), noteToMidi('G4')];
      const note = midiToNote(self._choose(ch));
      self.padSynth.triggerAttackRelease(note, 5, time, amp);

      // Swell noise layer for :hollow breathiness
      // Fade in over attack, fade out over release
      self.padNoiseGain.gain.cancelScheduledValues(time);
      self.padNoiseGain.gain.setValueAtTime(0, time);
      self.padNoiseGain.gain.linearRampToValueAtTime(amp * 0.15, time + 2);
      self.padNoiseGain.gain.linearRampToValueAtTime(0, time + 5);

      self.padLoop.interval = self._choose([6, 8]) * beatDur;
    }, 6 * beatDur);

    // ── Deep echo: every 8-12 beats ──
    this.deepLoop = new Tone.Loop((time) => {
      const v = self.data.velocity;
      if (v <= 0.3) {
        self.deepLoop.interval = self._choose([8, 10, 12]) * beatDur;
        return;
      }
      const t = self.data.tone;
      const notes = t === 1
        ? ['A3', 'C4', 'E4']
        : ['A3', 'C4', 'G#3'];
      const n = self._choose(notes);
      const amp = 0.04 + v * 0.06;
      self.deepSynth.triggerAttackRelease(n, 3, time, amp);

      self.deepLoop.interval = self._choose([8, 10, 12]) * beatDur;
    }, 8 * beatDur);

    // ── Price drift: every 3 seconds ──
    this.driftLoop = new Tone.Loop((time) => {
      const pd = self.data.price_delta;
      const mag = Math.abs(pd);
      if (mag <= 0.2) return;

      const sc = getScaleNotes('A4', 'minor_pentatonic', 14, 2);
      const num = Math.min(6, Math.max(2, 2 + Math.floor(mag * 6)));
      const vol = Math.min(0.14, Math.max(0.06, 0.06 + mag * 0.12));
      const ns = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();

      let offset = 0;
      const gaps = ns.map(() => self._choose([0.5, 0.75, 1.0]));
      ns.forEach((n, i) => {
        if (time + offset < 0) return;
        const v = vol * self._rrand(0.6, 1.0);
        const dur = gaps[i] * 0.9;  // release before next note
        self.driftSynth.triggerAttackRelease(n, dur, time + offset, v);
        offset += gaps[i];
      });
    }, 3);

    // ── Ambient drone: every 8 beats ──
    this.droneLoop = new Tone.Loop((time) => {
      if (self.data.ambient_mode !== 1) return;
      const notes = ['A2', 'E3', 'A3'];
      const n = self._choose(notes);
      self.droneSynth.triggerAttackRelease(n, 8, time, 0.12);
    }, '2m');
  }

  start() {
    Tone.Transport.bpm.value = 80;

    this.subLoop.start(0);
    this.bassLoop.start(0);
    this.arpLoop.start(0);
    this.kickLoop.start(0);
    this.kickGhostLoop.start(0);
    this.snareLoop.start('2n');       // offset 2 beats into the bar
    this.rimLoop.start(0);
    this.hatLoop.start(0);
    this.vinylLoop.start(0);
    this.padLoop.start(0);
    this.deepLoop.start('2m');        // delayed start
    this.driftLoop.start(0);
    this.droneLoop.start(0);

    // Start the noise source for pad breathiness
    this.padNoise.start();

    Tone.Transport.start();
  }

  stop() {
    if (this.disposed) return;
    this.disposed = true;

    const loops = [
      this.subLoop, this.bassLoop, this.arpLoop,
      this.kickLoop, this.kickGhostLoop, this.snareLoop,
      this.rimLoop, this.hatLoop, this.vinylLoop,
      this.padLoop, this.deepLoop, this.driftLoop, this.droneLoop,
    ];
    loops.forEach(l => { try { l.stop(); } catch (e) {} });

    Tone.Transport.stop();
    Tone.Transport.cancel();

    const nodes = [
      this.subSynth, this.subFilter,
      this.bassSynth, this.bassFilter,
      this.arpSynth, this.arpFilter, this.arpReverb,
      this.kickFilter, this.kickGhostFilter, this.kickPatternFilter,
      this.snareReverb, this.snareGhostReverb,
      this.hatFilter,
      this.padSynth, this.padFilter, this.padReverb,
      this.padNoise, this.padNoiseGain, this.padNoiseFilter,
      this.deepSynth, this.deepDelay, this.deepFilter, this.deepReverb,
      this.driftSynth, this.driftDelay, this.driftReverb, this.driftFilter,
      this.pianoSynth, this.moveReverb, this.moveDelay, this.moveFilter,
      this.spikeReverb,
      this.droneSynth, this.droneReverb, this.droneFilter,
      this.resolvedSynth, this.resolvedReverb, this.resolvedDelay, this.resolvedFilter,
    ];
    nodes.forEach(n => { try { n.dispose(); } catch (e) {} });
    loops.forEach(l => { try { l.dispose(); } catch (e) {} });
  }

  update(data) {
    this.data = { ...this.data, ...data };
  }

  onEvent(type, msg) {
    if (this.disposed) return;
    const now = Tone.now();

    if (type === 'spike') {
      const elapsed = Date.now() - this.lastSpikeAt;
      if (elapsed >= this.spikeCooldown) {
        this.lastSpikeAt = Date.now();
        this._playSample('drum_cymbal_soft', now, {
          amp: 0.10,
          playbackRate: 0.5,
          destination: this.spikeReverb,
        });
      }
    }

    if (type === 'price_move') {
      const dir = msg.direction || 1;
      const pd = this.data.price_delta;
      const mag = Math.abs(pd);

      const sc = getScaleNotes('A4', 'minor', 14, 2);
      const num = Math.min(7, Math.max(3, 3 + Math.floor(mag * 7)));
      const vol = Math.min(0.1, Math.max(0.04, 0.04 + mag * 0.12));
      const ns = dir > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();

      ns.forEach((n, i) => {
        const frac = i / Math.max(ns.length - 1, 1);
        const ampEnv = vol * (0.5 + frac * 0.3) * this._rrand(0.7, 1.0);
        this.pianoSynth.triggerAttackRelease(
          n, '4n', now + i * this._choose([0.4, 0.5, 0.6]), ampEnv * 0.97
        );
      });
    }

    if (type === 'resolved') {
      const result = msg.result || 1;
      const sc = result === 1
        ? getScaleNotes('A4', 'major', 8, 1)
        : getScaleNotes('A4', 'minor', 8, 1).reverse();

      sc.forEach((n, i) => {
        const frac = i / Math.max(sc.length - 1, 1);
        const amp = 0.1 * (0.5 + frac * 0.5) * 0.97;
        this.resolvedSynth.triggerAttackRelease(
          n, '4n', now + i * 0.5, amp
        );
      });
    }
  }
}

audioEngine.registerTrack('mezzanine', MezzanineTrack);
