// ── Oracle Track ──────────────────────────────────────────
// Alert track. Piano motifs respond to price movement.
// Faithful port of sonic_pi/oracle.rb.
// category: 'alert', label: 'Oracle'

class OracleTrack {
  constructor(destination) {
    this.destination = destination;
    this.data = {
      price_delta: 0,
      tone: 1,
      velocity: 0.1,
      trade_rate: 0.2,
    };

    // No volumeScale needed — masterGain (0.7) handles global level

    // Reverb: Sonic Pi room: 0.6, damp: 0.5
    this.reverb = new Tone.Reverb({
      decay: 3,
      wet: 0.6,
    }).connect(destination);

    // Pre-generate the reverb impulse response
    this.reverb.generate();

    // Lowpass to approximate Sonic Pi damp: 0.5 on the reverb tail
    this.dampFilter = new Tone.Filter({
      frequency: 3000,
      type: 'lowpass',
      rolloff: -12,
    }).connect(this.reverb);

    // Active voices for cleanup
    this._activeVoices = [];

    // Main loop: every 3 seconds, evaluate and possibly play a motif
    this.loop = new Tone.Loop((time) => this._tick(time), '3s');
  }

  start() {
    this.loop.start(0);
  }

  stop() {
    this.loop.stop();
    this._activeVoices.forEach((v) => {
      try { v.synth.dispose(); } catch (_) {}
      try { v.panner.dispose(); } catch (_) {}
    });
    this._activeVoices = [];
    this.dampFilter.disconnect();
    this.reverb.disconnect();
    this.dampFilter.dispose();
    this.reverb.dispose();
  }

  update(data) {
    this.data = { ...this.data, ...data };
  }

  onEvent(_type, _msg) {
    // Oracle relies on the main loop; no special event handling.
  }

  /**
   * Build a piano-like FM synth voice.
   *
   * Sonic Pi :piano is a physical modeling synth with `hard` (hammer
   * hardness / brightness) and `vel` (velocity / dynamics).
   *
   * FM piano approximation (inspired by DX7 E.Piano):
   * - Low modulationIndex (1-3) for warm tone, not metallic bells
   * - Very fast modulation envelope — brightness dies quickly like
   *   a real hammer strike (short mod decay = bright transient only)
   * - Carrier envelope with natural piano-like decay curve
   * - harmonicity: 2 (octave relationship) for clean overtones
   */
  _makeVoice(hard, vel, pan) {
    const panner = new Tone.Panner(pan).connect(this.dampFilter);

    const synth = new Tone.FMSynth({
      harmonicity: 2,
      // hard 0.1-0.3 → modIndex 1.4-2.2 (warm piano, not metallic)
      // Previous: 2 + hard * 10 = 3-5 (way too metallic/bell-like)
      modulationIndex: 1 + hard * 4,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: {
        attack: 0.003,
        // vel drives sustain length: higher velocity = longer ring
        decay: 0.5 + vel * 0.6,
        sustain: 0.12,
        release: 1.5,
      },
      modulationEnvelope: {
        // Very fast mod envelope = bright attack transient that dies quickly
        // This is the key to piano-like FM: brightness only on the hammer strike
        attack: 0.001,
        decay: 0.06 + hard * 0.12,   // hard → slightly longer brightness
        sustain: 0.0,
        release: 0.15,
      },
    }).connect(panner);

    return { synth, panner };
  }

  _tick(time) {
    const d = this.data;
    const pd = d.price_delta;
    const mag = Math.abs(pd);

    // Sonic Pi: if mag > 0.1 … else just sleep 3
    if (mag <= 0.1) return;

    // Root and scale
    const root = d.tone === 1 ? 'C4' : 'A3';
    const scaleType = d.tone === 1 ? 'major' : 'minor';

    // num = clamp(2 + floor(mag * 6), 2, 6)
    const numNotes = Math.min(6, Math.max(2, 2 + Math.floor(mag * 6)));

    // Build note array (2 octaves of scale, take numNotes)
    let notes = getScaleNotes(root, scaleType, numNotes, 2);
    if (pd < 0) notes = notes.slice().reverse();

    // activity = clamp(0.5 + velocity * 0.3 + trade_rate * 0.2, 0, 1)
    const activity = Math.min(1.0, 0.5 + d.velocity * 0.3 + d.trade_rate * 0.2);

    // vol = clamp(0.12 + mag * 0.35, 0.12, 0.30) * activity
    const vol = Math.min(0.30, Math.max(0.12, 0.12 + mag * 0.35)) * activity;

    // hard = clamp(0.1 + mag * 0.4, 0.1, 0.3)
    const hard = Math.min(0.3, Math.max(0.1, 0.1 + mag * 0.4));

    // vel = 0.2 + mag * 0.5
    const vel = 0.2 + mag * 0.5;

    // Play each note with 0.3s spacing, per-note panning and amplitude envelope
    notes.forEach((note, i) => {
      const frac = notes.length > 1 ? i / (notes.length - 1) : 0;

      // Sonic Pi: amp_env * 0.95
      const ampEnv = pd > 0
        ? vol * (0.7 + frac * 0.3)
        : vol * (1.0 - frac * 0.3);
      const amp = ampEnv * 0.95;

      // Pan: (frac - 0.5) * 0.3
      const pan = (frac - 0.5) * 0.3;

      const noteTime = time + i * 0.3;

      // Create a per-note voice for individual panning
      const voice = this._makeVoice(hard, vel, pan);
      this._activeVoices.push(voice);

      // Schedule note
      Tone.Transport.scheduleOnce((t) => {
        voice.synth.triggerAttackRelease(note, '4n', t, amp);
      }, noteTime);

      // Schedule cleanup after the note fully decays
      Tone.Transport.scheduleOnce(() => {
        const idx = this._activeVoices.indexOf(voice);
        if (idx !== -1) this._activeVoices.splice(idx, 1);
        try { voice.synth.dispose(); } catch (_) {}
        try { voice.panner.dispose(); } catch (_) {}
      }, noteTime + 3);
    });
  }
}

audioEngine.registerTrack('oracle', OracleTrack);
