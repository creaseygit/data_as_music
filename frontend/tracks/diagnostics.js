// ── Diagnostics ──────────────────────────────────────
// Silent "track" that speaks system status via the browser's built-in
// SpeechSynthesis API. Use it when you want to walk away from the
// screen and still know — audibly — that the data pipeline is alive,
// or when you want to measure the data pipeline's real latency by
// hearing price changes as they arrive from the server.
//
// - On each live-finance rotation or manual pick, announces the new
//   market title.
// - On every data tick where price has moved ≥ 0.5¢ since the last
//   announcement, speaks the new price percent ("fifty-two").
// - As a fallback during stale/flat periods, a "data OK" heartbeat
//   fires on a sensitivity-controlled cadence: sens=0 → every ~5 min,
//   sens=1 → every ~15 s, sens=0.5 → ~2 min.
// - Silence means something is wrong: all announcements fire from
//   data arrivals, so if data stops, announcements stop.
//
// Utterance gating: never more than one per 5 s, and never overlap
// an in-flight utterance. Price reads take ~2 s so 5 s between them
// keeps the channel clear without feeling drawn-out.
//
// The audio engine holds a Web Lock (stops background-tab throttling)
// and a Screen Wake Lock (stops OS idle sleep) while playing, so this
// track keeps announcing even if the laptop is left alone. Closing the
// lid still hardware-sleeps the machine; on wake the WebSocket
// reconnects and a fresh announcement resumes.
// category: 'diagnostic', label: 'Diagnostics'

const diagnostics = (() => {
  // Heartbeat cadence is scaled by the sensitivity slider.
  // sens=1 → HEARTBEAT_MIN_SECS. sens=0 → HEARTBEAT_MAX_SECS.
  const HEARTBEAT_MIN_SECS = 15;
  const HEARTBEAT_MAX_SECS = 300;

  // Floor between any two utterances. The SpeechSynthesis queue cannot
  // be reliably reasoned about, so we gate by wall time plus the .speaking
  // flag rather than queueing.
  const MIN_UTTERANCE_GAP_MS = 5000;

  // Minimum price delta since last announcement that triggers a read.
  // 0.005 = 0.5¢ on a 0–1 probability scale.
  const PRICE_CHANGE_THRESHOLD = 0.005;

  let _lastSpokeAt = 0;
  let _lastMarketSlug = null;
  let _selectedVoice = null;
  let _lastAnnouncedPrice = null;

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

  // Speak `text` iff the channel is idle and ≥ MIN_UTTERANCE_GAP_MS has
  // elapsed since the last utterance. Returns true when the utterance was
  // queued — callers use the return value to decide whether to advance
  // their "last announced" state.
  function speak(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return false;
      const now = Date.now();
      if (synth.speaking) return false;
      if (now - _lastSpokeAt < MIN_UTTERANCE_GAP_MS) return false;
      ensureVoice();
      const u = new SpeechSynthesisUtterance(text);
      if (_selectedVoice) u.voice = _selectedVoice;
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = 1.0;
      synth.speak(u);
      _lastSpokeAt = now;
      return true;
    } catch (e) {
      console.warn('[diagnostics] speech failed:', e);
      return false;
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
      _lastAnnouncedPrice = null;
      _lastSpokeAt = 0;
      speak("Diagnostics active");
    },

    evaluateCode(data) {
      const sens = data.sensitivity !== undefined ? data.sensitivity : 0.5;
      const price = data.price || 0;
      const pricePct = Math.round(price * 100);
      const now = Date.now();

      // Real-time price announcement: any ≥0.5¢ change since the last
      // announcement triggers a read. The speak() gate (5s floor +
      // skip-if-busy) throttles to at most one utterance every 5s even
      // on rapidly moving markets, so we don't queue up a backlog.
      const priceChanged =
        _lastAnnouncedPrice === null ||
        Math.abs(price - _lastAnnouncedPrice) >= PRICE_CHANGE_THRESHOLD;

      if (priceChanged) {
        if (speak(`${pricePct}`)) {
          _lastAnnouncedPrice = price;
        }
      } else {
        // No change — fall back to heartbeat so total silence means
        // the data pipeline itself has stalled.
        const heartbeatInterval = HEARTBEAT_MIN_SECS
          + (1 - sens) * (HEARTBEAT_MAX_SECS - HEARTBEAT_MIN_SECS);
        if (now - _lastSpokeAt >= heartbeatInterval * 1000) {
          speak(`Data OK. Price ${pricePct}.`);
        }
      }

      return "setcpm(20);\n$: silence;\n";
    },

    onMarketChange(market, _prev) {
      if (!market || !market.question) return;
      if (_lastMarketSlug === market.slug) return;
      _lastMarketSlug = market.slug;
      _lastAnnouncedPrice = null;
      speak(`Switched to ${cleanForSpeech(market.question)}`);
    },

    onEvent() { return null; },
  };
})();

audioEngine.registerTrack("diagnostics", diagnostics);
