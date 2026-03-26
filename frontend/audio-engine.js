// ── Audio Engine (Strudel) ────────────────────────────────
// Manages Strudel lifecycle, track loading, and market data routing.
// Strudel globals (note, s, stack, samples, etc.) are available
// after initStrudel() is called.

const audioEngine = (() => {
  let initialized = false;
  let currentTrackDef = null;
  let currentTrackName = null;
  let currentPattern = null;
  let masterVolume = 0.7;
  let latestData = {};
  let sampleNames = [];  // populated from server status message

  // Track registry — populated by track files calling audioEngine.registerTrack()
  const trackRegistry = {};

  async function init() {
    if (initialized) return;
    // Build sample map from server-provided sample names
    const sampleMap = {};
    for (const name of sampleNames) {
      sampleMap[name] = [name + '.ogg'];
    }
    await initStrudel({
      prebake: () => samples(sampleMap, '/static/samples/'),
    });
    initialized = true;
    console.log('[Audio] Strudel initialized');
  }

  async function selectTrack(name) {
    if (!initialized) await init();

    // Stop current pattern
    _stop();

    const trackDef = trackRegistry[name];
    if (!trackDef) {
      console.warn('[Audio] Unknown track:', name);
      return;
    }

    currentTrackDef = trackDef;
    currentTrackName = name;

    // Reset track state if it has an init method
    if (trackDef.init) {
      trackDef.init();
    }

    // Generate and play the initial pattern
    _regenerate();

    console.log('[Audio] Track started:', name);
  }

  function _stop() {
    try { hush(); } catch (e) {}
    currentPattern = null;
  }

  function _regenerate() {
    if (!currentTrackDef) return;

    try {
      const pat = currentTrackDef.pattern(latestData);
      if (pat) {
        currentPattern = pat.gain(masterVolume);
        currentPattern.play();
      }
    } catch (e) {
      console.warn('[Audio] Pattern generation error:', e);
    }
  }

  function stop() {
    _stop();
    currentTrackDef = null;
    currentTrackName = null;
  }

  function setVolume(v) {
    masterVolume = v;
    // Regenerate pattern with new volume
    if (currentTrackDef) {
      _stop();
      _regenerate();
    }
  }

  function onMarketData(data) {
    latestData = { ...latestData, ...data };
    if (currentTrackDef) {
      _stop();
      _regenerate();
    }
  }

  function handleEvent(msg) {
    if (currentTrackDef && currentTrackDef.onEvent) {
      const eventPat = currentTrackDef.onEvent(msg.event, msg, latestData);
      if (eventPat) {
        // Layer the event pattern on top of the current pattern
        _stop();
        try {
          const combined = currentTrackDef.pattern(latestData);
          if (combined) {
            currentPattern = stack(combined, eventPat).gain(masterVolume);
            currentPattern.play();
          }
        } catch (e) {
          console.warn('[Audio] Event pattern error:', e);
        }
      }
    }
  }

  function registerTrack(name, trackDef) {
    trackRegistry[name] = trackDef;
  }

  function setSampleNames(names) {
    sampleNames = names;
  }

  return {
    init, selectTrack, stop, setVolume, onMarketData,
    handleEvent, registerTrack, setSampleNames,
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
