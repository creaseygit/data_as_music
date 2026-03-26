// ── Just Vibes Track ─────────────────────────────────────
// Lo-fi hip hop. F major / D minor, 75 BPM.
// Faithful port of sonic_pi/just_vibes.rb
// category: 'music', label: 'Just Vibes'

class JustVibesTrack {
  constructor(destination) {
    this.dest = destination;
    this.data = { heat: 0.3, price: 0.5, velocity: 0.1, trade_rate: 0.2, spread: 0.2, tone: 1, price_delta: 0, ambient_mode: 0 };
    this.chordIdx = 0;
    this.spikeCooldown = 15000;
    this.lastSpikeAt = 0;
    this.disposed = false;
    this.samplesReady = false;

    // ── Preload samples ──
    const sampleNames = ['bd_fat', 'sn_dub', 'drum_cymbal_closed', 'drum_cowbell', 'vinyl_hiss', 'drum_cymbal_soft'];
    sampleBank.preload(sampleNames).then(() => {
      if (this.disposed) return;
      this.samplesReady = true;
    });

    // ── Sub bass (sine + LPF cutoff 50 MIDI) ──
    this.subFilter = new Tone.Filter({ frequency: midiToHz(50), type: 'lowpass' }).connect(destination);
    this.subSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.15, decay: 0.1, sustain: 0.8, release: 0.8 },
    }).connect(this.subFilter);

    // ── Bass line (tb303: sawtooth MonoSynth, res: 0.12) ──
    this.bassFilter = new Tone.Filter({ frequency: midiToHz(52), type: 'lowpass' }).connect(destination);
    this.bassSynth = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 0.12 * 30 },
      envelope: { attack: 0.01, decay: 0.25, sustain: 0, release: 0.1 },
      filterEnvelope: {
        attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.1,
        baseFrequency: midiToHz(42), octaves: 1.5,
      },
    }).connect(this.bassFilter);

    // ── Kick LPF chains (Sonic Pi cutoff on samples) ──
    this.kickFilter = new Tone.Filter({ frequency: midiToHz(60), type: 'lowpass' }).connect(destination);
    this.kickGhostFilter = new Tone.Filter({ frequency: midiToHz(50), type: 'lowpass' }).connect(destination);

    // ── Snare reverb chains ──
    this.snareReverb = new Tone.Reverb({ decay: 2.8, wet: 0.55 }).connect(destination);
    this.snareGhostReverb = new Tone.Reverb({ decay: 3, wet: 0.65 }).connect(destination);

    // ── Hat HPF ──
    this.hatHPF = new Tone.Filter({ frequency: midiToHz(105), type: 'highpass' }).connect(destination);

    // ── Pad (:hollow → triangle + noise layer + slow attack + heavy reverb + LPF) ──
    this.padReverb = new Tone.Reverb({ decay: 5, wet: 0.7 }).connect(destination);
    this.padFilter = new Tone.Filter({ frequency: midiToHz(58), type: 'lowpass' }).connect(this.padReverb);
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 2.5, decay: 1, sustain: 0.5, release: 5 },
    }).connect(this.padFilter);
    // Noise layer for breathy :hollow character
    this.padNoiseFilter = new Tone.Filter({ frequency: midiToHz(58), type: 'bandpass', Q: 2 }).connect(this.padReverb);
    this.padNoiseGain = new Tone.Gain(0).connect(this.padNoiseFilter);
    this.padNoise = new Tone.Noise('pink').connect(this.padNoiseGain);

    // ── Deep echo (:dark_ambience → detuned saw pair + echo + LPF) ──
    this.deepFilter = new Tone.Filter({ frequency: midiToHz(65), type: 'lowpass' }).connect(destination);
    this.deepDelay = new Tone.FeedbackDelay({ delayTime: 1.0, feedback: 0.35, wet: 0.5 }).connect(this.deepFilter);
    this.deepSynth = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', spread: 20, count: 2 },
      envelope: { attack: 1.5, decay: 0.5, sustain: 0.3, release: 4 },
    }).connect(this.deepDelay);

    // ── Spike reverb ──
    this.spikeReverb = new Tone.Reverb({ decay: 2.8, wet: 0.65 }).connect(destination);

    // ── Price drift: :piano → FM synth + reverb + LPF ──
    this.priceDriftFilter = new Tone.Filter({ frequency: midiToHz(82), type: 'lowpass' }).connect(destination);
    this.priceDriftReverb = new Tone.Reverb({ decay: 4, wet: 0.75 }).connect(this.priceDriftFilter);
    this.priceDriftSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 0.5,
      envelope: { attack: 0.01, decay: 0.35, sustain: 0.08, release: 1.0 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
    }).connect(this.priceDriftReverb);

    // ── Event move: :piano → FM synth + reverb + echo + LPF ──
    this.eventMoveFilter = new Tone.Filter({ frequency: midiToHz(85), type: 'lowpass' }).connect(destination);
    this.eventMoveDelay = new Tone.FeedbackDelay({ delayTime: 0.75, feedback: 0.3, wet: 0.45 }).connect(this.eventMoveFilter);
    this.eventMoveReverb = new Tone.Reverb({ decay: 5, wet: 0.8 }).connect(this.eventMoveDelay);
    this.eventMoveSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 0.5,
      envelope: { attack: 0.01, decay: 0.35, sustain: 0.08, release: 1.0 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
    }).connect(this.eventMoveReverb);

    // ── Resolved: :piano → FM synth + reverb + echo ──
    this.resolvedReverb = new Tone.Reverb({ decay: 5, wet: 0.8 }).connect(destination);
    this.resolvedDelay = new Tone.FeedbackDelay({ delayTime: 0.5, feedback: 0.3, wet: 0.4 }).connect(this.resolvedReverb);
    this.resolvedSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 0.5,
      envelope: { attack: 0.01, decay: 0.35, sustain: 0.08, release: 1.0 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.5 },
    }).connect(this.resolvedDelay);

    // ── Ambient drone (:dark_ambience → detuned saw + reverb + LPF) ──
    this.droneFilter = new Tone.Filter({ frequency: midiToHz(58), type: 'lowpass' }).connect(destination);
    this.droneReverb = new Tone.Reverb({ decay: 6, wet: 0.85 }).connect(this.droneFilter);
    this.droneSynth = new Tone.Synth({
      oscillator: { type: 'fatsawtooth', spread: 20, count: 2 },
      envelope: { attack: 4, decay: 0.5, sustain: 0.3, release: 8 },
    }).connect(this.droneReverb);

    this._buildLoops();
  }

  /**
   * Play a sample with Sonic Pi-compatible parameters.
   * Matches mezzanine's _playSample signature for consistency.
   */
  _playSample(name, time, opts = {}) {
    if (!this.samplesReady || this.disposed) return;

    sampleBank.load(name).then((buf) => {
      if (this.disposed) return;

      const p = new Tone.Player(buf);

      if (opts.playbackRate !== undefined) {
        p.playbackRate = opts.playbackRate;
      }

      // Build signal chain: player -> gain -> [panner] -> destination
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

  _getRoots() {
    return this.data.tone === 1
      ? ['F2', 'E2', 'D2', 'C2']
      : ['D2', 'A#1', 'G1', 'A1'];
  }

  _getChords() {
    return this.data.tone === 1
      ? [['F3', 'A3', 'C4', 'E4'], ['E3', 'G3', 'B3', 'D4'],
         ['D3', 'F3', 'A3', 'C4'], ['C3', 'E3', 'G3', 'B3']]
      : [['D3', 'F3', 'A3', 'C4'], ['A#2', 'D3', 'F3', 'A3'],
         ['G2', 'A#2', 'D3', 'F3'], ['A2', 'C3', 'E3', 'G3']];
  }

  _rrand(min, max) { return min + Math.random() * (max - min); }

  _choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  _buildLoops() {
    const self = this;
    const bps = 60 / 75;  // seconds per beat

    // ── Chord clock: every 4 beats ──
    this.chordLoop = new Tone.Loop(() => {
      self.chordIdx = (self.chordIdx + 1) % 4;
    }, bps * 4);

    // ── Vinyl: every 8 beats ──
    this.vinylLoop = new Tone.Loop((time) => {
      self._playSample('vinyl_hiss', time, {
        amp: 0.04,
        playbackRate: 0.7,
      });
    }, bps * 8);

    // ── Kick: every 4 beats ──
    // Sonic Pi: sample :bd_fat, cutoff: 60, rate: 0.8
    this.kickLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const tr = self.data.trade_rate;
      const amp_val = 0.16 + h * 0.08;

      // Beat 1: cutoff: 60
      self._playSample('bd_fat', time, {
        amp: amp_val, playbackRate: 0.8,
        destination: self.kickFilter,       // LPF cutoff: 60
      });

      // Ghost kick at beat 1.5: cutoff: 50
      if (tr > 0.4 && Math.random() < 0.25) {
        self._playSample('bd_fat', time + bps * 1.5, {
          amp: amp_val * 0.25, playbackRate: 0.75,
          destination: self.kickGhostFilter, // LPF cutoff: 50
        });
      }

      // Beat 3: cutoff: 60
      self._playSample('bd_fat', time + bps * 2, {
        amp: amp_val * 0.9, playbackRate: 0.8,
        destination: self.kickFilter,
      });
    }, bps * 4);

    // ── Snare: offset 2 beats, every 4 beats ──
    // Sonic Pi: finish: 0.25, ghost finish: 0.15
    this.snareLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const amp = 0.07 + h * 0.05;

      self._playSample('sn_dub', time, {
        amp: amp, playbackRate: 0.85,
        finish: 0.25,                       // tight lo-fi snare
        destination: self.snareReverb,
      });

      // Ghost snare: finish: 0.15 (even tighter)
      if (Math.random() < 0.15) {
        self._playSample('sn_dub', time + bps * 1.75, {
          amp: 0.03, playbackRate: 0.9,
          finish: 0.15,
          destination: self.snareGhostReverb,
        });
      }
    }, bps * 4);

    // ── Hats: 16th note grid, skip odd ticks when tr <= 0.5 ──
    // Sonic Pi: finish: 0.04, pan: rrand(-0.3, 0.3)
    this.hatTickCount = 0;
    this.hatLoop = new Tone.Loop((time) => {
      const tr = self.data.trade_rate;
      self.hatTickCount++;
      if (tr <= 0.5 && self.hatTickCount % 2 !== 0) return;

      const prob = 0.12 + tr * 0.35;
      if (Math.random() < prob) {
        const amp = self._rrand(0.02, 0.06);
        self._playSample('drum_cymbal_closed', time, {
          amp: amp,
          playbackRate: self._rrand(1.3, 1.7),
          finish: 0.04,                     // crisp tick
          pan: self._rrand(-0.3, 0.3),
          destination: self.hatHPF,
        });
      }
    }, bps * 0.25);

    // ── Rim: every 0.25 beats, 16-step pattern ──
    // Sonic Pi: finish: 0.03, pan: rrand(-0.15, 0.15)
    this.rimStep = 0;
    this.rimPattern = [0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0];
    this.rimLoop = new Tone.Loop((time) => {
      const tr = self.data.trade_rate;
      if (tr > 0.2 && self.rimPattern[self.rimStep % 16] === 1) {
        self._playSample('drum_cowbell', time, {
          amp: 0.03,
          playbackRate: 2.8,
          finish: 0.03,                     // tiny tick
          pan: self._rrand(-0.15, 0.15),
        });
      }
      self.rimStep++;
    }, bps * 0.25);

    // ── Sub bass: every 4 beats ──
    this.subLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const roots = self._getRoots();
      const root = roots[self.chordIdx];
      const amp = 0.12 + h * 0.06;
      self.subSynth.triggerAttackRelease(root, bps * 3 + bps * 0.8, time, amp);
    }, bps * 4);

    // ── Bass line: every 4 beats, tb303-style phrases ──
    this.bassLoop = new Tone.Loop((time) => {
      const h = self.data.heat;
      const pr = self.data.price;
      const cut = 42 + pr * 18;
      self.bassFilter.frequency.rampTo(midiToHz(cut + 10), 0.1);

      const roots = self._getRoots();
      const rootMidi = noteToMidi(roots[self.chordIdx]);
      const rn = rootMidi;
      const amp_val = 0.08 + h * 0.06;

      const R = null;
      const phrases = [
        [rn, 1.5, R, 0.5, rn + 7, 0.5, R, 0.5, rn, 0.5],
        [R, 0.5, rn, 1.0, rn + 5, 0.5, R, 0.5, rn, 1.5],
        [rn, 1.0, R, 0.5, rn + 7, 0.5, rn + 5, 0.5, R, 0.5, rn, 0.5, R, 0.5],
        [rn, 0.5, R, 1.0, rn + 3, 0.5, rn, 1.0, R, 1.0],
      ];
      const phrase = self._choose(phrases);

      let offset = 0;
      for (let i = 0; i < phrase.length; i += 2) {
        const n = phrase[i];
        const dur = phrase[i + 1];
        if (n !== null) {
          const noteName = midiToNote(n);
          const releaseDur = Math.min(dur * 0.6, 0.3) * bps;
          const vel = amp_val * self._rrand(0.8, 1.0);
          self.bassSynth.triggerAttackRelease(noteName, releaseDur, time + offset * bps, vel);
        }
        offset += dur;
      }
    }, bps * 4);

    // ── Pad wash: self-scheduling for random 6-8 beat intervals ──
    this._schedulePad();

    // ── Deep echo: self-scheduling for random 10-14 beat intervals ──
    this._scheduleDeep();

    // ── Price drift: every 3 seconds ──
    this.priceDriftLoop = new Tone.Loop((time) => {
      self._playPriceDrift(time);
    }, 3);

    // ── Ambient drone: every 8 beats ──
    this.droneLoop = new Tone.Loop((time) => {
      if (self.data.ambient_mode === 1) {
        const notes = ['F2', 'C3', 'F3'];
        const note = self._choose(notes);
        const amp = 0.10;
        self.droneSynth.triggerAttackRelease(note, bps * 8, time, amp);
      }
    }, bps * 8);
  }

  _schedulePad() {
    if (this.disposed) return;
    const self = this;
    const bps = 60 / 75;
    const beats = self._choose([6, 8]);
    const intervalSec = bps * beats;

    this.padEvent = Tone.Transport.scheduleOnce((time) => {
      const h = self.data.heat;
      const pr = self.data.price;
      const cutFreq = midiToHz(58 + pr * 18);
      self.padFilter.frequency.rampTo(cutFreq, 0.5);
      // Tune noise bandpass to follow pad cutoff for breathy character
      self.padNoiseFilter.frequency.rampTo(cutFreq, 0.5);

      const amp = Math.max(0.05, 0.10 - h * 0.05);
      const chords = self._getChords();
      const chord = chords[self.chordIdx];
      self.padSynth.triggerAttackRelease(chord, bps * 5, time, amp);

      // Swell noise layer for :hollow breathiness
      self.padNoiseGain.gain.cancelScheduledValues(time);
      self.padNoiseGain.gain.setValueAtTime(0, time);
      self.padNoiseGain.gain.linearRampToValueAtTime(amp * 0.12, time + 2);
      self.padNoiseGain.gain.linearRampToValueAtTime(0, time + 5);

      self._schedulePad();
    }, Tone.Transport.seconds + intervalSec);
  }

  _scheduleDeep() {
    if (this.disposed) return;
    const self = this;
    const bps = 60 / 75;
    const beats = self._choose([10, 12, 14]);
    const intervalSec = bps * beats;

    this.deepEvent = Tone.Transport.scheduleOnce((time) => {
      const v = self.data.velocity;
      if (v > 0.25) {
        const roots = self._getRoots();
        const root = self._choose(roots);
        const rootMidi = noteToMidi(root) + 24;
        const amp = 0.03 + v * 0.06;
        self.deepSynth.triggerAttackRelease(midiToNote(rootMidi), bps * 4, time, amp);
      }
      self._scheduleDeep();
    }, Tone.Transport.seconds + intervalSec);
  }

  _playPriceDrift(time) {
    const pd = this.data.price_delta;
    const mag = Math.abs(pd);
    if (mag <= 0.2) return;

    const t = this.data.tone;
    const scaleRoot = t === 1 ? 'F4' : 'D4';
    const scaleType = t === 1 ? 'major_pentatonic' : 'minor_pentatonic';
    const sc = getScaleNotes(scaleRoot, scaleType, 20, 2);

    const num = Math.min(Math.max(2 + Math.floor(mag * 5), 2), 5);
    const vol = Math.min(Math.max(0.06 + mag * 0.08, 0.06), 0.12);
    const ns = pd > 0 ? sc.slice(0, num) : sc.slice(0, num).reverse();

    let offset = 0;
    ns.forEach((n) => {
      const vl = vol * this._rrand(0.6, 1.0);
      const amp = vl * 0.97 * 0.95;
      this.priceDriftSynth.triggerAttackRelease(n, '4n', time + offset, amp);
      offset += this._choose([0.5, 0.75, 1.0]);
    });
  }

  start() {
    Tone.Transport.bpm.value = 75;
    const bps = 60 / 75;

    this.chordLoop.start(0);
    this.vinylLoop.start(0);
    this.kickLoop.start(0);
    this.snareLoop.start(bps * 2);  // offset 2 beats
    this.hatLoop.start(0);
    this.rimLoop.start(0);
    this.subLoop.start(0);
    this.bassLoop.start(0);
    this.priceDriftLoop.start(0);
    this.droneLoop.start(0);

    // Start noise source for pad breathiness
    this.padNoise.start();

    Tone.Transport.start();
  }

  stop() {
    if (this.disposed) return;
    this.disposed = true;

    [this.chordLoop, this.vinylLoop, this.kickLoop, this.snareLoop,
     this.hatLoop, this.rimLoop, this.subLoop, this.bassLoop,
     this.priceDriftLoop, this.droneLoop,
    ].forEach(l => { if (l) { try { l.stop(); l.dispose(); } catch (e) {} } });

    if (this.padEvent !== undefined) {
      try { Tone.Transport.clear(this.padEvent); } catch (e) {}
    }
    if (this.deepEvent !== undefined) {
      try { Tone.Transport.clear(this.deepEvent); } catch (e) {}
    }

    Tone.Transport.stop();
    Tone.Transport.cancel();

    [this.subSynth, this.subFilter,
     this.bassSynth, this.bassFilter,
     this.kickFilter, this.kickGhostFilter,
     this.padSynth, this.padFilter, this.padReverb,
     this.padNoise, this.padNoiseGain, this.padNoiseFilter,
     this.deepSynth, this.deepDelay, this.deepFilter,
     this.snareReverb, this.snareGhostReverb,
     this.hatHPF,
     this.spikeReverb,
     this.priceDriftSynth, this.priceDriftReverb, this.priceDriftFilter,
     this.eventMoveSynth, this.eventMoveReverb, this.eventMoveDelay, this.eventMoveFilter,
     this.resolvedSynth, this.resolvedReverb, this.resolvedDelay,
     this.droneSynth, this.droneReverb, this.droneFilter,
    ].forEach(n => { try { n.dispose(); } catch (e) {} });
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
          amp: 0.08,
          playbackRate: 0.45,
          destination: this.spikeReverb,
        });
      }
    }

    if (type === 'price_move') {
      const dir = msg.direction || 1;
      const t = this.data.tone;
      const scaleRoot = t === 1 ? 'F4' : 'D4';
      const scaleType = t === 1 ? 'major' : 'minor';
      const sc = getScaleNotes(scaleRoot, scaleType, 7, 2);
      const ns = dir > 0 ? sc : sc.slice().reverse();

      let offset = 0;
      ns.forEach((n, i) => {
        const frac = i / Math.max(ns.length - 1, 1);
        const amp_env = dir > 0
          ? 0.09 * (0.5 + frac * 0.3)
          : 0.09 * (0.9 - frac * 0.3);
        const amp = amp_env * 0.97 * 0.95;
        this.eventMoveSynth.triggerAttackRelease(n, '4n', now + offset, amp);
        offset += this._choose([0.4, 0.5, 0.6]);
      });
    }

    if (type === 'resolved') {
      const result = msg.result || 1;
      const scaleRoot = result === 1 ? 'F4' : 'D4';
      const scaleType = result === 1 ? 'major' : 'minor';
      let sc = getScaleNotes(scaleRoot, scaleType, 8, 1);
      if (result !== 1) sc = sc.reverse();

      sc.forEach((n, i) => {
        const frac = i / Math.max(sc.length - 1, 1);
        const amp = 0.09 * (0.5 + frac * 0.5) * 0.97 * 0.95;
        this.resolvedSynth.triggerAttackRelease(n, '4n', now + i * 0.5, amp);
      });
    }
  }
}

audioEngine.registerTrack('just_vibes', JustVibesTrack);
