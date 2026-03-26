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
  let latestData = {};

  // Track registry — populated by track files calling audioEngine.registerTrack()
  const trackRegistry = {};

  async function init() {
    if (initialized) return;
    await initStrudel({
      prebake: () => Promise.all([
        samples('https://strudel.b-cdn.net/piano.json', 'https://strudel.b-cdn.net/piano/', { prebake: true }),
        samples('github:tidalcycles/dirt-samples'),
      ]),
    });

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
        // Piano — one sample per ~3 semitones, cover C3-C6 range
        // (Salamander Grand Piano loads a separate .wav per pitch zone)
        note("c3 e3 a3 c4 e4 a4 c5 e5 a5 c6").sound("piano"),
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

    // Generate and play the initial pattern
    _playPattern();

    console.log('[Audio] Track started:', name);
  }

  /**
   * Play (or replace) the current pattern.
   * Calling .play() on a new pattern seamlessly replaces the previous one
   * without needing hush() — avoids the cyclist stop/start spam.
   */
  function _playPattern() {
    if (!currentTrackDef) return;

    try {
      const pat = currentTrackDef.pattern(latestData);
      if (pat) {
        pat.gain(masterVolume).play();
      } else {
        // Track wants silence — replace current pattern with empty one.
        // Without this, the previous non-null pattern keeps looping.
        silence.play();
      }
      // Always mark as playing so data updates keep regenerating the pattern.
      // Otherwise a track that starts silent (e.g. oracle with no movement)
      // never wakes up when data changes.
      playing = true;
    } catch (e) {
      console.warn('[Audio] Pattern generation error:', e);
    }
  }

  function stop() {
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
  }

  function setVolume(v) {
    masterVolume = v;
    // Regenerate pattern with new volume — seamless replacement via .play()
    if (playing && currentTrackDef) {
      _playPattern();
    }
  }

  function onMarketData(data) {
    latestData = { ...latestData, ...data };
    // Only regenerate if we're supposed to be playing
    if (playing && currentTrackDef) {
      _playPattern();
    }
  }

  function handleEvent(msg) {
    if (!playing || !currentTrackDef || !currentTrackDef.onEvent) return;

    const eventPat = currentTrackDef.onEvent(msg.event, msg, latestData);
    if (eventPat) {
      // Layer the event pattern on top of the current pattern
      try {
        const base = currentTrackDef.pattern(latestData);
        if (base) {
          stack(base, eventPat).gain(masterVolume).play();
        }
      } catch (e) {
        console.warn('[Audio] Event pattern error:', e);
      }
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
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  m7minus5: [0, 3, 6, 10],
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

/** Convert MIDI note number to Hz. */
function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
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
