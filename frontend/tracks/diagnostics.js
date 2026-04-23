// ── Diagnostics ──────────────────────────────────────
// Silent "track" that speaks system status via the browser's built-in
// SpeechSynthesis API. Use it when you want to walk away from the
// screen and still know — audibly — that the data pipeline is alive
// and that live-finance market rotation is still happening.
//
// - On each live-finance rotation or manual pick, announces the new
//   market title.
// - Every HEARTBEAT_SECS of continuous data flow, announces a short
//   "data OK" heartbeat with current heat and tone.
// - Silence means something is wrong: the heartbeat fires from data
//   arrivals, so if data stops, announcements stop.
//
// The audio engine holds a Web Lock and plays active audio while this
// track runs, which prevents most browsers from throttling the tab in
// the background. Laptop sleep will still pause everything; on wake
// the WebSocket reconnects and a fresh announcement resumes.
// category: 'diagnostic', label: 'Diagnostics'

const diagnostics = (() => {
  const HEARTBEAT_SECS = 120;

  let _lastSpokeAt = 0;
  let _lastMarketSlug = null;

  function speak(text) {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
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
      _lastSpokeAt = Date.now();
      _lastMarketSlug = null;
      speak("Diagnostics active");
    },

    evaluateCode(data) {
      const now = Date.now();
      if (now - _lastSpokeAt >= HEARTBEAT_SECS * 1000) {
        const heatPct = Math.round((data.heat || 0) * 100);
        const toneStr = data.tone === 0 ? "bearish" : "bullish";
        speak(`Data OK. Heat ${heatPct}. ${toneStr}.`);
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
