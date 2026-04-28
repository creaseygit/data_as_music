// ── Data as Music — Main UI Logic ──────────────────────
// Handles browse tabs, market selection, sliders, and UI updates.
// Depends on: ws-client.js (wsClient), audio-engine.js (audioEngine)

let browseCache = {};
let activeTab = null;
let currentMarketSlug = null;
let currentEventSlug = null;
let audioRunning = false;

// Server-facing sensitivity (0-1). Set by the bare percentage slider in
// the audio bar. The server interprets this as a unified "reactivity"
// knob: smaller values widen the price-delta deadzone, stretch the band
// thresholds, lengthen the analysis window, and dampen the power-curve
// signals together — so at low sensitivity the music ignores small moves
// across the board, while preserving dynamic range within the bands.
const _SENSITIVITY_DEFAULT = 0.5;
let currentSensitivity = _SENSITIVITY_DEFAULT;

// ── ET → local time conversion for market names ──
function convertETtoLocal(text) {
  // Match: "April 2, 4:25AM–4:30AM ET", "April 2, 4AM ET", "April 2, 4:25 AM - 4:30 AM ET"
  // Time can be "4AM", "4:25AM", "4:25 AM" — separator can be hyphen or en dash
  return text.replace(
    /(\w+ \d{1,2}),?\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))(?:\s*[\u2013\u2014-]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)))?\s+ET\b/gi,
    (match, datePart, time1, time2) => {
      try {
        const year = new Date().getFullYear();
        // Normalize "3:50AM" → "3:50 AM", "4AM" → "4:00 AM" (Date() requires space + minutes)
        const normTime = (t) => {
          let s = t.replace(/(\d)\s*(AM|PM)/i, '$1 $2');
          if (!s.includes(':')) s = s.replace(/^(\d+)/, '$1:00');
          return s;
        };
        const parseET = (dateStr, timeStr) => {
          const ts = normTime(timeStr);
          let etDate = new Date(`${dateStr}, ${year} ${ts} EDT`);
          if (isNaN(etDate)) etDate = new Date(`${dateStr}, ${year} ${ts} EST`);
          if (isNaN(etDate)) return null;
          return etDate;
        };
        const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const fmtDate = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });

        const d1 = parseET(datePart, time1);
        if (!d1) return match;

        const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tzAbbr = localTZ === 'America/New_York' ? 'ET'
          : d1.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();

        if (time2) {
          const d2 = parseET(datePart, time2);
          if (!d2) return match;
          return `${fmtDate(d1)}, ${fmtTime(d1)}\u2013${fmtTime(d2)} ${tzAbbr}`;
        }
        return `${fmtDate(d1)}, ${fmtTime(d1)} ${tzAbbr}`;
      } catch (e) {
        return match; // On any error, return original text
      }
    }
  );
}

// ── Live finance detection ──
const _LIVE_SLUG_RE = /^(btc|eth)-updown-\d+m-\d+$|^bitcoin-up-or-down-.+-et$/;

function livePrefix(eventSlug) {
  if (!eventSlug || !_LIVE_SLUG_RE.test(eventSlug)) return null;
  // Strip trailing timestamp (5m/15m) or date suffix (hourly)
  let prefix = eventSlug.replace(/-\d+$/, '');
  prefix = prefix.replace(/-[a-z]+-\d+-\d+-\d+[ap]m-et$/, '');
  return prefix;
}

// ── URL hash state ──
function getHashParams() {
  const params = {};
  const hash = location.hash.slice(1);
  if (!hash) return params;
  hash.split('&').forEach(part => {
    const [k, v] = part.split('=');
    if (k && v) params[decodeURIComponent(k)] = decodeURIComponent(v);
  });
  return params;
}

function updateHash() {
  const parts = [];
  // For live finance markets, store the prefix so it resolves to the current window
  const lp = livePrefix(currentEventSlug);
  if (lp) {
    parts.push('live=' + encodeURIComponent(lp));
  } else if (currentMarketSlug) {
    parts.push('market=' + encodeURIComponent(currentMarketSlug));
  }
  const track = document.getElementById('track-select');
  if (track && track.value) parts.push('track=' + encodeURIComponent(track.value));
  const sensPct = Math.round(currentSensitivity * 100);
  const defaultPct = Math.round(_SENSITIVITY_DEFAULT * 100);
  if (sensPct !== defaultPct) parts.push('sens=' + sensPct);
  // Persist active browse tab so shared links show the right category
  if (activeTab) parts.push('tab=' + encodeURIComponent(activeTab));
  const newHash = parts.length ? '#' + parts.join('&') : '';
  if ('#' + location.hash.slice(1) !== newHash) {
    history.replaceState(null, '', newHash || location.pathname + location.search);
  }
}

let hashApplied = false;
function applyHashOnce() {
  if (hashApplied) return;
  hashApplied = true;
  const params = getHashParams();
  if (!params.market && !params.live && !params.track) return;

  // Apply sensitivity before market pin so the server uses it from the first broadcast
  if (params.sens) {
    const pct = parseInt(params.sens);
    if (pct >= 0 && pct <= 100) {
      currentSensitivity = pct / 100;
      _updateSensitivityUI(pct);
      wsClient.send({ action: 'sensitivity', value: currentSensitivity });
    }
  }

  // Apply track selection first
  if (params.track) {
    const sel = document.getElementById('track-select');
    if (sel) {
      for (const opt of sel.options) {
        if (opt.value === params.track) { sel.value = params.track; break; }
      }
    }
  }

  // Pin the market so data starts flowing and UI populates
  if (params.live) {
    wsClient.send({ action: 'play_live', prefix: params.live });
    log('Loading live market: ' + params.live);
  } else if (params.market) {
    wsClient.send({ action: 'pin', slug: params.market });
    log('Loading market from URL: ' + params.market);
  }

  // Market is pinned and data will flow — user just needs to press Play
  if (params.market || params.live) {
    log('Press Play to start audio.');
  }
}

// ── HTML escaping ──
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Logging ──
function log(msg) {
  const el = document.getElementById('log');
  const t = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  line.textContent = '[' + t + '] ' + msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ── HTTP helper (for browse/categories only) ──
async function api(path) {
  const r = await fetch(path);
  return r.json();
}

// ── Audio control ──
async function startAudio() {
  try {
    const track = document.getElementById('track-select').value;
    const btn = document.getElementById('audio-toggle-btn');
    if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
    await audioEngine.init();
    await audioEngine.selectTrack(track);
    audioRunning = true;
    if (btn) btn.disabled = false;
    updateAudioUI();
    log('Audio started: ' + track);
  } catch (e) {
    const btn = document.getElementById('audio-toggle-btn');
    if (btn) btn.disabled = false;
    log('ERR: ' + e.message);
  }
}

function stopAudio() {
  audioEngine.stop();
  audioRunning = false;
  updateAudioUI();
  updateHash();
  log('Audio stopped');
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
}

function toggleAudio() {
  if (audioRunning) {
    stopAudio();
  } else {
    startAudio();
  }
}

function onTrackChange() {
  const track = document.getElementById('track-select').value;
  if (audioRunning) {
    audioEngine.selectTrack(track);
    updateAudioUI();
    log('Switched to: ' + track);
  }
  wsClient.send({ action: 'track', name: track });
  updateHash();
  _renderVoiceRack();
}

// ── Volume (client-side only) ──
let volumeTimer = null;
function onVolumeChange(rawVal) {
  const pct = parseInt(rawVal);
  document.getElementById('volume-label').textContent = pct + '%';
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    audioEngine.setVolume(pct / 100);
  }, 50);
}

// ── Sensitivity (sent to server) ──
// The slider is a bare 0–100% control. The server reads `sensitivity` as
// the unified reactivity knob — band thresholds, lookback window, event
// thresholds and intensity power-curve all scale off the same value.
function _updateSensitivityUI(pct) {
  const slider = document.getElementById('sensitivity-slider');
  const label = document.getElementById('sensitivity-label');
  if (slider) slider.value = pct;
  if (label) label.textContent = `${pct}%`;
}

let _sensSendDebounce;
function onSensitivityChange(pct) {
  pct = Math.max(0, Math.min(100, parseInt(pct, 10)));
  currentSensitivity = pct / 100;
  _updateSensitivityUI(pct);
  // Debounce while dragging so we don't flood the WS with tick-by-tick
  // updates; the URL hash gets the same treatment.
  clearTimeout(_sensSendDebounce);
  _sensSendDebounce = setTimeout(() => {
    wsClient.send({ action: 'sensitivity', value: currentSensitivity });
    updateHash();
  }, 50);
}

// Initial label/slider sync on page load.
// app.js is loaded at the bottom of <body> so the DOM is already parsed.
_updateSensitivityUI(Math.round(currentSensitivity * 100));

// ── Share ──
function shareUrl() {
  updateHash();
  navigator.clipboard.writeText(location.href).then(() => {
    const btn = document.getElementById('share-btn');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.color = '#00ff88';
    setTimeout(() => { btn.textContent = orig; btn.style.color = '#aaa'; }, 1500);
  });
}

// ── URL play ──
function playUrl() {
  const input = document.getElementById('url-input');
  const status = document.getElementById('url-status');
  const url = input.value.trim();
  if (!url) return;
  status.textContent = 'Loading...';
  status.style.color = '#00aaff';

  // Auto-start audio if not running
  if (!audioRunning) {
    startAudio();
  }

  wsClient.send({ action: 'play_url', url });
  input.value = '';
  // Status will be updated by WS market_info or error message
  setTimeout(() => { if (status.textContent === 'Loading...') status.textContent = ''; }, 5000);
}

// ── Play from browse ──
function playBrowseMarket(slug, question, eventSlug) {
  if (!audioRunning) {
    startAudio();
  }
  // For live finance markets, use play_live so server fetches with proper event_slug for rotation
  const lp = livePrefix(eventSlug);
  if (lp) {
    wsClient.send({ action: 'play_live', prefix: lp });
  } else {
    wsClient.send({ action: 'pin', slug: slug });
  }
  log('Playing: ' + question);
}

// ── Browse tabs ──
function initBrowse(categories) {
  const tabs = document.getElementById('browse-tabs');
  tabs.innerHTML = (categories || []).map(c => {
    const tid = c.tag_id === null ? 'null' : c.tag_id;
    const sort = c.sort || 'volume';
    return '<button class="browse-tab" data-tag="' + tid + '" data-sort="' + sort + '" onclick="browseTab(this)">' + c.label + '</button>';
  }).join('');

  // Select the tab from the URL hash, or "live" for live links, or first tab
  const params = getHashParams();
  let target = null;
  if (params.tab) {
    const [tag, sort] = params.tab.split(':');
    target = tabs.querySelector('.browse-tab[data-tag="' + tag + '"][data-sort="' + (sort || 'volume') + '"]');
  }
  if (!target && params.live) {
    target = tabs.querySelector('.browse-tab[data-tag="live"]');
  }
  if (!target) target = tabs.querySelector('.browse-tab');
  if (target) browseTab(target);
}

async function browseTab(btn, skipCache) {
  document.querySelectorAll('.browse-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tagId = btn.dataset.tag;
  const sort = btn.dataset.sort;
  const cacheKey = tagId + ':' + sort;
  activeTab = cacheKey;

  if (!skipCache && browseCache[cacheKey] && tagId !== 'live') {
    renderBrowse(browseCache[cacheKey]);
    return;
  }

  document.getElementById('browse-results').innerHTML = '<div class="browse-loading">Loading...</div>';
  const params = new URLSearchParams({ sort, limit: '10' });
  if (tagId !== 'null') params.set('tag_id', tagId);
  try {
    const r = await api('/api/browse?' + params);
    if (r.ok && activeTab === cacheKey) {
      browseCache[cacheKey] = r.markets;
      renderBrowse(r.markets);
    }
  } catch (e) {
    document.getElementById('browse-results').innerHTML = '<div class="browse-loading">Failed to load</div>';
  }
}

function refreshBrowse() {
  const active = document.querySelector('.browse-tab.active');
  if (!active) return;
  browseTab(active, true);
}

// Auto-refresh browse every 60 seconds
setInterval(() => {
  const active = document.querySelector('.browse-tab.active');
  if (active) browseTab(active, true);
}, 60000);

function renderBrowse(markets) {
  const el = document.getElementById('browse-results');
  if (!markets.length) {
    el.innerHTML = '<div class="browse-loading">No markets found</div>';
    return;
  }
  el.innerHTML = markets.map(m => {
    const slug = (m.slug || '').replace(/'/g, "\\'");
    const q = (m.question || '').replace(/'/g, "\\'");
    const es = (m.event_slug || m.slug || '').replace(/'/g, "\\'");
    const link = es ? 'https://polymarket.com/event/' + esc(es) : '';
    const pricePct = m.price !== null ? (m.price * 100).toFixed(0) + '%' : '';
    const vol = m.volume > 0 ? '$' + (m.volume / 1000).toFixed(0) + 'k' : '';
    const isPlaying = currentMarketSlug === m.slug;
    const cls = isPlaying ? 'browse-card playing' : 'browse-card';
    const playBtn = isPlaying
      ? '<button class="browse-play-btn is-playing" disabled>Playing</button>'
      : '<button class="browse-play-btn" onclick="playBrowseMarket(\'' + slug + '\',\'' + q + '\',\'' + es + '\')">Play</button>';
    return '<div class="' + cls + '">'
      + '<div class="browse-body">'
      + '<div class="browse-question">' + esc(convertETtoLocal((m.question || '').substring(0, 65))) + '</div>'
      + '<div class="browse-meta">' + esc(vol) + '</div>'
      + '</div>'
      + (pricePct ? '<div class="browse-price">' + esc(pricePct) + '</div>' : '')
      + (link ? '<a class="market-link" href="' + link + '" target="_blank" rel="noopener">View &#x2197;</a>' : '')
      + playBtn
      + '</div>';
  }).join('');
}

// ── UI update functions (called by ws-client) ──
function updateAudioUI() {
  const ad = document.getElementById('audio-dot');
  const prompt = document.getElementById('audio-prompt');
  const grid = document.getElementById('audio-grid');
  const btn = document.getElementById('audio-toggle-btn');
  const hasMarket = !!currentMarketSlug;

  ad.className = 'dot ' + (audioRunning ? 'dot-on' : 'dot-off');
  const track = document.getElementById('track-select').value;
  document.getElementById('audio-label').textContent = audioRunning ? 'Playing: ' + track : 'Stopped';

  if (hasMarket || audioRunning) {
    prompt.style.display = 'none';
    grid.style.display = '';
    btn.textContent = audioRunning ? 'Stop' : 'Play';
    btn.className = audioRunning ? 'danger' : 'ready';
  } else {
    prompt.style.display = '';
    grid.style.display = 'none';
  }
}

// ── Dynamic track loader ──
// Loads track JS files reported by the server, so adding a new .js file
// to frontend/tracks/ is all that's needed — no index.html changes.
let _tracksLoaded = false;
function loadTrackScripts(tracks, { reload = false } = {}) {
  if (_tracksLoaded && !reload) return Promise.resolve();
  _tracksLoaded = true;
  // Always cache-bust: track files are hand-edited frequently and the
  // payload is tiny, so paying for a fresh fetch beats serving stale JS.
  const bust = `?v=${Date.now()}`;
  return Promise.all(tracks.map(t => {
    if (reload) {
      // On reload, fetch script text and eval it — avoids const re-declaration
      // errors that occur when re-injecting <script> tags (removing a tag from
      // the DOM doesn't remove its const bindings from the global scope).
      return fetch(`/static/tracks/${t.name}.js${bust}`)
        .then(r => r.text())
        .then(code => { (0, eval)(code); })
        .catch(() => console.warn('[Tracks] Failed to reload:', t.name));
    }
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `/static/tracks/${t.name}.js${bust}`;
      s.onload = resolve;
      s.onerror = () => { console.warn('[Tracks] Failed to load:', t.name); resolve(); };
      document.head.appendChild(s);
    });
  }));
}

async function onWsStatus(data) {
  // Dynamically load track scripts from the server's discovered list
  const sel = document.getElementById('track-select');
  const firstLoad = sel.options.length === 0;
  if (data.tracks) {
    if (firstLoad) {
      await loadTrackScripts(data.tracks);

      const groups = {};
      data.tracks.forEach(t => {
        const cat = t.category || 'music';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(t);
      });
      const order = [['music', 'Music'], ['alert', 'Alerts'], ['funny', 'Funny'], ['diagnostic', 'Diagnostic']];
      order.forEach(([key, label]) => {
        if (!groups[key]) return;
        const og = document.createElement('optgroup');
        og.label = label;
        groups[key].forEach(t => og.appendChild(new Option(t.label, t.name)));
        sel.add(og);
      });
    } else {
      // Reconnect — re-fetch track scripts in case they were updated
      await loadTrackScripts(data.tracks, { reload: true });
    }
  }
  // Init browse tabs
  if (data.categories) {
    initBrowse(data.categories);
  }

  // Apply URL hash params after tracks are populated
  applyHashOnce();
}

// ── Voice rack + warmup banner ─────────────────────────────
// The Now-Playing panel shows each voice of the current track as a live
// meter (user gain × track energy). Voices are rebuilt when the selected
// track changes. The meter is an honest approximation: it reflects what
// the track as a whole is doing (heat / price_move / momentum), not
// per-voice detail the engine doesn't know. Solo/mute from the Sandbox
// shows as muted.

let _voiceRackBuiltFor = null;

function _currentTrackDef() {
  if (typeof audioEngine === 'undefined') return null;
  const name = audioEngine.getCurrentTrackName?.()
    || document.getElementById('track-select')?.value;
  if (!name) return null;
  const reg = audioEngine.getTrackRegistry?.();
  return reg ? reg[name] : null;
}

function _trackEnergy(data) {
  const h = Math.max(0, Math.min(1, data.heat ?? 0));
  const pm = Math.abs(data.price_move ?? 0);
  const mom = Math.abs(data.momentum ?? 0);
  return Math.max(h, pm, mom);
}

function _renderVoiceRack() {
  const container = document.getElementById('np-voices');
  if (!container) return;
  const track = _currentTrackDef();
  _voiceRackBuiltFor = track ? track.name : null;
  const voices = track?.voices ? Object.entries(track.voices) : [];

  if (!voices.length) {
    container.innerHTML = '<div class="voice-rack-empty">This track runs on its own logic — no voices to meter.</div>';
    return;
  }

  container.innerHTML = voices.map(([id, v]) => {
    if (v.meter === 'delta') {
      // Horizontal stepped gauge: 3 down cells | silence | 3 up cells.
      // Each cell is self-labelled with arrow + note-count so the band
      // structure is readable without knowing the colour code. Active
      // cell fills brightly; _updateVoiceRack toggles the .active class.
      // Bands are server-decided (sensitivity-scaled), so the labels
      // describe the musical response (phrase length), not fixed ¢ ranges.
      const cellSpec = [
        { band: -3, label: '▼8', cls: 'down', title: '8-note DOWN (large move)' },
        { band: -2, label: '▼5', cls: 'down', title: '5-note DOWN (medium move)' },
        { band: -1, label: '▼3', cls: 'down', title: '3-note DOWN (small move)' },
        { band:  0, label: '·',  cls: 'zero', title: 'silence (deadzone or flat)' },
        { band:  1, label: '▲3', cls: 'up',   title: '3-note UP (small move)' },
        { band:  2, label: '▲5', cls: 'up',   title: '5-note UP (medium move)' },
        { band:  3, label: '▲8', cls: 'up',   title: '8-note UP (large move)' },
      ];
      const cells = cellSpec.map(c =>
        `<div class="delta-cell delta-cell-${c.cls}" `
        + `data-band="${c.band}" title="${c.title}">${c.label}</div>`
      ).join('');
      return `
        <div class="voice-row-np voice-row-delta" id="vrow-${id}">
          <span class="voice-row-label">${v.label}</span>
          <div class="delta-gauge" id="dgauge-${id}">${cells}</div>
          <span class="voice-row-state" id="vstate-${id}">·</span>
        </div>`;
    }
    return `
      <div class="voice-row-np" id="vrow-${id}">
        <span class="voice-row-label">${v.label}</span>
        <div class="voice-row-meter"><div class="voice-row-meter-fill" id="vfill-${id}"></div></div>
        <span class="voice-row-state" id="vstate-${id}">·</span>
      </div>`;
  }).join('');
}

// Band index in [-3, 3] keyed to the server-computed price_delta_band.
// Server is the single source of truth for band thresholds (which scale
// with sensitivity), so the gauge cell always matches the audio decision.
// Closed gate (price_moving=false) collapses to 0, regardless of cents.
function _deltaBand(band, moving) {
  if (!moving) return 0;
  return band | 0;
}

function _updateVoiceRack(data) {
  const track = _currentTrackDef();
  if (!track || !track.voices) return;

  const expected = track.name;
  if (_voiceRackBuiltFor !== expected) _renderVoiceRack();

  const energy = _trackEnergy(data);
  // Mild expansion so low activity still reads as "present"
  const shaped = Math.pow(energy, 0.7);

  for (const [voiceId, voiceDef] of Object.entries(track.voices)) {
    const gain = track.getGain ? track.getGain(voiceId) : 1.0;
    const row = document.getElementById('vrow-' + voiceId);
    const state = document.getElementById('vstate-' + voiceId);
    if (row) row.classList.toggle('voice-row-muted', gain === 0);

    if (voiceDef.meter === 'delta') {
      const cents = data.price_delta_cents ?? 0;
      const moving = data.price_moving === true;
      const band = _deltaBand(data.price_delta_band ?? 0, moving);
      const gauge = document.getElementById('dgauge-' + voiceId);
      if (gauge) {
        gauge.classList.toggle('delta-gauge-flat', !moving);
        for (const cell of gauge.children) {
          const cellBand = parseInt(cell.dataset.band, 10);
          cell.classList.toggle('active', cellBand === band);
        }
      }
      if (state) {
        if (gain === 0) state.textContent = 'off';
        else if (Math.abs(cents) < 0.05) state.textContent = '·';
        else state.textContent = (cents > 0 ? '+' : '') + cents.toFixed(1) + '¢';
      }
    } else {
      const level = Math.max(0, Math.min(1, gain * shaped));
      const fill = document.getElementById('vfill-' + voiceId);
      if (fill) fill.style.width = (level * 100) + '%';
      if (state) state.textContent = gain === 0 ? 'off' : (level < 0.05 ? '·' : Math.round(level * 100));
    }
  }
}

function _updatePriceBar(data) {
  const needle = document.getElementById('np-price-needle');
  const value = document.getElementById('np-price-value');
  const p = Math.max(0, Math.min(1, data.price ?? 0.5));
  if (needle) needle.style.left = (p * 100) + '%';
  if (value) {
    const tone = data.tone === 1 ? 'bullish' : 'bearish';
    value.className = 'np-price-value ' + tone;
    value.textContent = (p * 100).toFixed(0) + '%';
  }
}

function _updateWarmupBanner(data) {
  const banner = document.getElementById('np-warmup');
  if (!banner) return;
  const w = data.warmup_factor ?? 1;
  if (w >= 1.0) {
    banner.style.display = 'none';
    banner.classList.remove('tuned');
    return;
  }
  banner.style.display = '';
  banner.classList.remove('tuned');
  banner.textContent = 'Tuning in';
}

function onWsMarketData(data) {
  const np = document.getElementById('np');
  if (!np || np.style.display === 'none') return;

  const mood = document.getElementById('np-mood');
  if (!mood) return;

  const toneStr = data.tone === 1 ? 'bullish' : 'bearish';
  mood.textContent = toneStr.toUpperCase() + '  ' + (data.price * 100).toFixed(1) + '%';
  mood.className = 'np-mood ' + toneStr;

  _updatePriceBar(data);
  _updateVoiceRack(data);
  _updateWarmupBanner(data);

  if (audioRunning) {
    audioEngine.onMarketData(data);
  }
}

function onWsMarketInfo(market) {
  // Server confirmed market state — upgrade status to fully connected
  document.getElementById('ws-dot').className = 'dot dot-on';
  document.getElementById('ws-label').textContent = 'Connected';

  const np = document.getElementById('np');
  if (!market) {
    np.style.display = 'none';
    currentMarketSlug = null;
    currentEventSlug = null;
    updateHash();
    updateAudioUI();
    if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
    return;
  }
  const slugChanged = market.slug !== currentMarketSlug;
  np.style.display = '';
  currentMarketSlug = market.slug;
  currentEventSlug = market.event_slug || null;
  updateHash();
  updateAudioUI();
  document.getElementById('np-question').textContent = convertETtoLocal(market.question);
  const npLink = document.getElementById('np-link');
  if (market.link) {
    npLink.href = market.link;
    npLink.style.display = '';
  } else {
    npLink.style.display = 'none';
  }
  document.getElementById('url-status').textContent = '';
  log('Now playing: ' + convertETtoLocal(market.question));
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);

  if (slugChanged) _renderVoiceRack();

  if (audioRunning) {
    audioEngine.onMarketInfo(market);
  }
}

function onWsEvent(msg) {
  // Events drive tracks silently — the log panel is for diagnostics only
  // (connection, market switch, errors, audio start/stop), not market-state.
  if (audioRunning) {
    audioEngine.handleEvent(msg);
  }
}

function onWsListeners(count) {
  const el = document.getElementById('listeners');
  if (el) el.textContent = count > 1 ? `${count} listeners` : '';
}

function onWsConnected() {
  // Reset damping so first data after reconnect snaps to actual values
  // instead of slowly sliding from stale pre-disconnect state
  audioEngine.resetDamping();

  // Re-send client state so the new server session picks up where we left off
  const lp = livePrefix(currentEventSlug);
  const hasMarketToRestore = !!(lp || currentMarketSlug);

  if (hasMarketToRestore) {
    // Show amber "Syncing..." until server confirms market via market_info
    document.getElementById('ws-dot').className = 'dot dot-sync';
    document.getElementById('ws-label').textContent = 'Syncing...';
    if (lp) {
      wsClient.send({ action: 'play_live', prefix: lp });
    } else {
      wsClient.send({ action: 'pin', slug: currentMarketSlug });
    }
  } else {
    // No market to restore — connection alone is sufficient
    document.getElementById('ws-dot').className = 'dot dot-on';
    document.getElementById('ws-label').textContent = 'Connected';
  }

  const track = document.getElementById('track-select');
  if (track && track.value) {
    wsClient.send({ action: 'track', name: track.value });
  }
  wsClient.send({ action: 'sensitivity', value: currentSensitivity });
}

function onWsDisconnected() {
  document.getElementById('ws-dot').className = 'dot dot-off';
  document.getElementById('ws-label').textContent = 'Reconnecting...';
}

function onWsError(msg) {
  log('Error: ' + msg);
  const status = document.getElementById('url-status');
  status.textContent = msg;
  status.style.color = '#ff4444';
  // If we were syncing and the server rejected, upgrade to connected (no market)
  if (document.getElementById('ws-label').textContent === 'Syncing...') {
    document.getElementById('ws-dot').className = 'dot dot-on';
    document.getElementById('ws-label').textContent = 'Connected';
  }
}

// ── Background tab recovery ──
// When the user switches back to this tab, resume audio if the browser
// suspended the AudioContext and verify the WebSocket is still alive.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  audioEngine.resumeIfSuspended();
  audioEngine.reacquireScreenWakeLock();
  wsClient.ensureConnected();
});

// ── Init ──
log('Ready. Pick a market to play, or paste a market URL.');
wsClient.connect();
