// ── Audio Engine (Strudel) ────────────────────────────────
// Manages Strudel lifecycle, track loading, and market data routing.
// Strudel globals (note, s, stack, samples, etc.) are available
// after initStrudel() is called.

const audioEngine = (() => {
  let initialized = false;
  let playing = false;
  let currentTrackDef = null;
  let currentTrackName = null;
  let masterVolume = 0.7;
  let _masterGainNode = null;  // Web Audio GainNode on master output
  let latestData = {};
  let _lastTrackPat = null;  // track pattern identity — skip .play() when unchanged

  // ── Cycle-boundary buffering ──
  // Data/events/volume changes are buffered and applied at the next cycle
  // boundary so that pattern rebuilds never interrupt music mid-bar.
  let _pendingData = null;       // market data waiting for next boundary
  let _pendingEvents = [];       // events waiting for next boundary
  let _boundaryTimer = null;     // setTimeout handle
  let _playEpoch = 0;            // AudioContext time when playback started
  let _forceNextPlay = false;    // force pattern rebuild at next boundary

  // Track registry — populated by track files calling audioEngine.registerTrack()
  const trackRegistry = {};

  async function init() {
    if (initialized) return;
    const CDN = 'https://strudel.b-cdn.net';
    const DM = `${CDN}/tidal-drum-machines/machines`;
    await initStrudel({
      prebake: async () => {
        await Promise.all([
          samples(`${CDN}/piano.json`, `${CDN}/piano/`, { prebake: true }),
          samples('github:tidalcycles/dirt-samples'),
          // VCSL instrument samples (orchestral percussion, etc.)
          samples(`${CDN}/vcsl.json`, `${CDN}/VCSL/`, { prebake: true }),
          // Tidal drum machines (Roland TR-808 etc.)
          samples(`${CDN}/tidal-drum-machines.json`, `${DM}/`, { prebake: true, tag: 'drum-machines' }),
          // uzu-drumkit — default drum sounds: rd (ride), rim (rimshot), etc.
          samples(`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' }),
          // GM soundfonts (acoustic bass, strings, brass, etc.)
          registerSoundfonts(),
        ]);
        // Create short aliases (rd, rim, etc.) from tidal drum machine names
        await aliasBank(`${CDN}/tidal-drum-machines-alias.json`);
      },
    });

    // Insert a master GainNode between Strudel's output and the speakers.
    // Override ctx.destination so all Strudel patterns (both evaluate and
    // pattern mode) route through our gain — this is the volume slider control.
    try {
      const ctx = getAudioContext();
      const realDest = ctx.destination;
      _masterGainNode = ctx.createGain();
      _masterGainNode.gain.value = masterVolume;
      _masterGainNode.connect(realDest);
      // Copy AudioDestinationNode properties that Strudel reads internally
      // (e.g. maxChannelCount) so getTrigger doesn't set channelCount to 0.
      _masterGainNode.channelCount = realDest.channelCount;
      _masterGainNode.channelCountMode = realDest.channelCountMode;
      _masterGainNode.channelInterpretation = realDest.channelInterpretation;
      Object.defineProperty(_masterGainNode, 'maxChannelCount', {
        get: () => realDest.maxChannelCount,
      });
      Object.defineProperty(ctx, 'destination', {
        get: () => _masterGainNode,
        configurable: true,
      });
    } catch (e) {
      console.warn('[Audio] Master gain setup failed (non-fatal):', e);
    }

    // Warm up sample buffers — Dirt-Samples index loads during prebake but
    // the actual .wav files are fetched lazily on first trigger.  Play a
    // short silent pattern that touches every drum sound we use so the
    // browser fetches and decodes them before the user hears anything.
    // Poll until the sampler reports no pending loads (up to 8s).
    try {
      stack(
        // Drums
        sound("bd:0 bd:1 bd:3"),
        sound("sd:0 sd:1"),
        sound("hh:0 hh:2 hh:6 hh:8"),
        sound("cb:0"),
        // Ride cymbals (Dirt-Samples cr + tidal-drum-machines rd)
        sound("cr:0 cr:1 cr:2 cr:3"),
        sound("rd"),
        sound("rim"),
        // Piano — one sample per ~3 semitones, cover C3-C6 range
        // (Salamander Grand Piano loads a separate .wav per pitch zone)
        note("c3 e3 a3 c4 e4 a4 c5 e5 a5 c6").sound("piano"),
        // GM soundfont acoustic bass — warm up the soundfont loader
        note("c2 e2 a2").sound("gm_acoustic_bass"),
      ).gain(0).play();
      // Wait for fetches to complete — CDN samples take 2-4s
      await new Promise(r => setTimeout(r, 5000));
      hush();
      console.log('[Audio] Sample warmup complete');
    } catch (e) {
      console.warn('[Audio] Sample warmup error (non-fatal):', e);
    }

    initialized = true;
    console.log('[Audio] Strudel initialized');
  }

  async function selectTrack(name) {
    if (!initialized) await init();

    // Stop current pattern fully
    try { hush(); } catch (e) { console.warn('[Audio] hush error:', e); }
    playing = false;

    const trackDef = trackRegistry[name];
    if (!trackDef) {
      console.warn('[Audio] Unknown track:', name);
      return;
    }

    currentTrackDef = trackDef;
    currentTrackName = name;

    // Reset track state
    if (trackDef.init) {
      trackDef.init();
    }

    // Resume AudioContext if it was suspended by stop()
    try {
      if (typeof getAudioContext === 'function') {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
      }
    } catch (e) { console.warn('[Audio] resume error:', e); }

    // Record playback epoch for cycle-boundary calculations
    _cancelBoundary();
    try {
      _playEpoch = getAudioContext().currentTime;
    } catch (e) { _playEpoch = 0; }

    // Merge any pending data so the first play uses latest values
    if (_pendingData) {
      latestData = { ...latestData, ..._pendingData };
      _pendingData = null;
    }

    // Generate and play the initial pattern (force — first play after track switch)
    _lastTrackPat = null;
    _playPattern();

    console.log('[Audio] Track started:', name);
  }

  /**
   * Play (or replace) the current pattern.
   *
   * Two modes:
   * 1. evaluate mode — track has evaluateCode(data) that returns a strudel
   *    code string.  We pass it to evaluate() which runs it through the
   *    transpiler exactly like strudel.cc's REPL ($:, setcpm, .orbit, etc.).
   * 2. pattern mode — track has pattern(data) that returns a Pattern object.
   *    We call .play() on it directly.
   *
   * Pass force=true when volume changes or after events to ensure a replay.
   */
  function _playPattern(force) {
    if (!currentTrackDef) return;

    try {
      // ── evaluate mode (preferred for faithful strudel.cc reproduction) ──
      if (currentTrackDef.evaluateCode) {
        const code = currentTrackDef.evaluateCode(latestData);
        if (code && (force || code !== _lastTrackPat)) {
          evaluate(code);
          _lastTrackPat = code;
        }
        playing = true;
        return;
      }

      // ── pattern mode (legacy tracks) ──
      const pat = currentTrackDef.pattern(latestData);
      if (pat) {
        if (force || pat !== _lastTrackPat) {
          pat.play();
          _lastTrackPat = pat;
        }
      } else {
        if (_lastTrackPat !== null) {
          silence.play();
          _lastTrackPat = null;
        }
      }
      playing = true;
    } catch (e) {
      console.warn('[Audio] Pattern generation error:', e);
    }
  }

  // ── Cycle-boundary scheduling ──────────────────────────────
  // Tracks declare `cpm` (cycles per minute). We use AudioContext time +
  // the track's CPM to estimate where we are within the current cycle.
  // Data changes are deferred to the next downbeat (cycle boundary).

  /** Approximate milliseconds until the next cycle boundary. */
  function _msUntilNextBoundary() {
    const cpm = currentTrackDef?.cpm;
    if (!cpm || cpm <= 0) return 0;  // no CPM → apply immediately
    try {
      const ctx = getAudioContext();
      if (!ctx || ctx.state !== 'running') return 0;
      const cps = cpm / 60;
      const elapsed = ctx.currentTime - _playEpoch;
      const phase = (elapsed * cps) % 1;  // 0-1 position within cycle
      if (phase < 0.08) return 0;  // already near downbeat
      return Math.max(0, ((1 - phase) / cps) * 1000);
    } catch (e) {
      return 0;
    }
  }

  /** Schedule a boundary flush if not already scheduled. */
  function _scheduleBoundary() {
    if (_boundaryTimer) return;  // already waiting
    const ms = _msUntilNextBoundary();
    if (ms <= 30) {
      _flushAtBoundary();
    } else {
      _boundaryTimer = setTimeout(() => {
        _boundaryTimer = null;
        _flushAtBoundary();
      }, ms);
    }
  }

  /** Apply all buffered changes at a cycle boundary. */
  function _flushAtBoundary() {
    // Merge pending data
    if (_pendingData) {
      latestData = { ...latestData, ..._pendingData };
      _pendingData = null;
    }

    // Rebuild pattern (with force if volume changed)
    if (playing && currentTrackDef) {
      const force = _forceNextPlay;
      _forceNextPlay = false;
      _playPattern(force);
    }

    // Process buffered events
    while (_pendingEvents.length > 0) {
      _processEvent(_pendingEvents.shift());
    }
  }

  /** Cancel any pending boundary timer. */
  function _cancelBoundary() {
    if (_boundaryTimer) {
      clearTimeout(_boundaryTimer);
      _boundaryTimer = null;
    }
    _pendingData = null;
    _pendingEvents = [];
    _forceNextPlay = false;
  }

  function stop() {
    _cancelBoundary();
    try { hush(); } catch (e) { console.warn('[Audio] hush error:', e); }
    // Suspend AudioContext to immediately silence reverb/delay tails
    try {
      if (typeof getAudioContext === 'function') {
        getAudioContext().suspend();
      }
    } catch (e) { console.warn('[Audio] suspend error:', e); }
    playing = false;
    currentTrackDef = null;
    currentTrackName = null;
    _lastTrackPat = null;
  }

  function setVolume(v) {
    masterVolume = v;
    // Update the master gain node directly — no pattern rebuild needed
    if (_masterGainNode) {
      _masterGainNode.gain.value = v;
    }
  }

  function onMarketData(data) {
    // Buffer data — apply at next cycle boundary so we never interrupt mid-bar
    _pendingData = { ...(_pendingData || {}), ...data };
    if (playing && currentTrackDef) {
      _scheduleBoundary();
    }
  }

  function handleEvent(msg) {
    if (!playing || !currentTrackDef || !currentTrackDef.onEvent) return;
    // Queue event for next cycle boundary
    _pendingEvents.push(msg);
    _scheduleBoundary();
  }

  /** Process a single event (called at cycle boundary from _flushAtBoundary).
   *
   * Unified: onEvent returns the appropriate type for the track's mode:
   * - evaluate-mode tracks → return a code string (appended to base code)
   * - pattern-mode tracks → return a Pattern object (stacked with base)
   */
  function _processEvent(msg) {
    if (!playing || !currentTrackDef?.onEvent) return;

    const result = currentTrackDef.onEvent(msg.event, msg, latestData);
    if (!result) return;

    try {
      if (currentTrackDef.evaluateCode) {
        // result is a code string — append to base evaluate code
        const baseCode = currentTrackDef.evaluateCode(latestData);
        if (baseCode) {
          evaluate(baseCode + '\n' + result);
          _lastTrackPat = null;  // force fresh evaluate on next data push
        }
      } else if (currentTrackDef.pattern) {
        // result is a Pattern — stack with base pattern
        const base = currentTrackDef.pattern(latestData);
        if (base) {
          stack(base, result).play();
          _lastTrackPat = null;
        }
      }
    } catch (e) {
      console.warn('[Audio] Event pattern error:', e);
    }
  }

  function registerTrack(name, trackDef) {
    trackRegistry[name] = trackDef;
  }

  return {
    init, selectTrack, stop, setVolume, onMarketData,
    handleEvent, registerTrack,
  };
})();

// ── Music theory utilities ──────────────────────────────────
// These are pure functions, no audio engine dependency.

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

function midiToNote(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const oct = Math.floor(midi / 12) - 1;
  return names[midi % 12] + oct;
}

function noteToMidi(note) {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d)$/);
  if (!match) return 60;
  const names = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
    'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const key = match[1][0].toUpperCase() + match[1].slice(1);
  return (names[key] ?? 0) + (parseInt(match[2]) + 1) * 12;
}

function getScaleNotes(rootNote, scaleType, count, octaves) {
  octaves = octaves || 2;
  const rootMidi = typeof rootNote === 'string' ? noteToMidi(rootNote) : rootNote;
  const intervals = SCALES[scaleType] || SCALES.major;
  const notes = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const interval of intervals) {
      notes.push(midiToNote(rootMidi + oct * 12 + interval));
    }
  }
  return notes.slice(0, count);
}

/** Convert note name to Strudel-compatible lowercase format.
 *  C#4 -> cs4, Bb3 -> bb3, A3 -> a3, G#4 -> gs4
 *  Strudel uses: lowercase, 's' for sharp, 'b' for flat (same as input).
 *  Only '#' needs replacing with 's'. Flats ('b') stay as-is in Strudel.
 */
function noteToStrudel(noteName) {
  return noteName.toLowerCase().replace('#', 's');
}
