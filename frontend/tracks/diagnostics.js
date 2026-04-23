// ── Diagnostics ──────────────────────────────────────
// Silent "track" that speaks system status via the browser's built-in
// SpeechSynthesis API. Use it when you want to walk away from the
// screen and still know — audibly — that the data pipeline is alive
// and that live-finance market rotation is still happening.
//
// - On each live-finance rotation or manual pick, announces the new
//   market title.
// - Announces a short "data OK" heartbeat with current price on a
//   sensitivity-controlled cadence: sens=0 → every ~5 minutes,
//   sens=1 → every ~15 seconds, sens=0.5 → ~2 minutes.
// - Silence means something is wrong: the heartbeat fires from data
//   arrivals, so if data stops, announcements stop.
//
// The audio engine holds a Web Lock and plays active audio while this
// track runs, which prevents most browsers from throttling the tab in
// the background. Laptop sleep will still pause everything; on wake
// the WebSocket reconnects and a fresh announcement resumes.
// category: 'diagnostic', label: 'Diagnostics'

const diagnostics = (() => {
  // Heartbeat cadence is scaled by the sensitivity slider.
  // sens=1 → HEARTBEAT_MIN_SECS. sens=0 → HEARTBEAT_MAX_SECS.
  const HEARTBEAT_MIN_SECS = 15;
  const HEARTBEAT_MAX_SECS = 300;

  let _lastSpokeAt = 0;
  let _lastMarketSlug = null;
  let _selectedVoice = null;

  // SpeechSynthesisVoice has no gender field. Apple/Google English
  // female voices are identified by either "Female" in the name or
  // one of these known first names.
  const FEMALE_NAMES = new Set([
    'samantha','karen','moira','tessa','fiona','serena','kate','victoria',
    'allison','ava','susan','vicki','zoe','alice','amelie','amélie','anna',
    'catherine','ellen','helena','laura','monica','paulina','sara','yuna',
    'kyoko','veena','princess','nora','alva','carmit','ioana','joana',
    'milena','melina','luciana','mariska','mei-jia','satu','zosia','zuzana',
  ]);

  function isFemale(v) {
    if (/female/i.test(v.name)) return true;
    const first = v.name.split(/[\s-]/)[0].toLowerCase();
    return FEMALE_NAMES.has(first);
  }

  // Priority: UK female > any English female > UK > any English > anything.
  function pickVoice() {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices();
    if (!voices.length) return null;
    const en = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
    const gb = en.filter(v => v.lang.toLowerCase() === 'en-gb');
    const picked = gb.find(isFemale)
                || en.find(isFemale)
                || gb[0]
                || en[0]
                || voices[0];
    return picked || null;
  }

  function ensureVoice() {
    if (_selectedVoice) return;
    _selectedVoice = pickVoice();
    if (_selectedVoice) {
      console.log(`[diagnostics] voice: ${_selectedVoice.name} (${_selectedVoice.lang})`);
      return;
    }
    // Chrome populates the voice list asynchronously — retry on event.
    const synth = window.speechSynthesis;
    if (synth && typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', () => {
        if (_selectedVoice) return;
        _selectedVoice = pickVoice();
        if (_selectedVoice) {
          console.log(`[diagnostics] voice: ${_selectedVoice.name} (${_selectedVoice.lang})`);
        }
      }, { once: true });
    }
  }

  function speak(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      ensureVoice();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (_selectedVoice) u.voice = _selectedVoice;
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = 1.0;
      synth.speak(u);
      _lastSpokeAt = Date.now();
    } catch (e) {
      console.warn('[diagnostics] speech failed:', e);
    }
  }

  // Strip markdown-ish punctuation that sounds bad read aloud.
  function cleanForSpeech(s) {
    return (s || '')
      .replace(/[“”"']/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return {
    name: "diagnostics",
    label: "Diagnostics",
    category: "diagnostic",
    cpm: 20,

    voices: {},
    gains: {},
    getGain() { return 1.0; },

    init() {
      _lastMarketSlug = null;
      speak("Diagnostics active");
      // Nudge the first heartbeat to fire ~20s in regardless of sensitivity,
      // so the user gets quick confirmation the pipeline is actually live.
      _lastSpokeAt = Date.now() - (HEARTBEAT_MAX_SECS - 20) * 1000;
    },

    evaluateCode(data) {
      const sens = data.sensitivity !== undefined ? data.sensitivity : 0.5;
      const interval = HEARTBEAT_MIN_SECS
        + (1 - sens) * (HEARTBEAT_MAX_SECS - HEARTBEAT_MIN_SECS);
      const now = Date.now();
      if (now - _lastSpokeAt >= interval * 1000) {
        const pricePct = Math.round((data.price || 0) * 100);
        speak(`Data OK. Price ${pricePct}.`);
      }
      return "setcpm(20);\n$: silence;\n";
    },

    onMarketChange(market, _prev) {
      if (!market || !market.question) return;
      if (_lastMarketSlug === market.slug) return;
      _lastMarketSlug = market.slug;
      speak(`Switched to ${cleanForSpeech(market.question)}`);
    },

    onEvent() { return null; },
  };
})();

audioEngine.registerTrack("diagnostics", diagnostics);
