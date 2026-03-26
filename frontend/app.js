// ── The Polymarket DJ — Main UI Logic ──────────────────────
// Handles browse tabs, market selection, sliders, and UI updates.
// Depends on: ws-client.js (wsClient), audio-engine.js (audioEngine)

let browseCache = {};
let activeTab = null;
let currentMarketSlug = null;
let audioRunning = false;

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
    await audioEngine.init();
    await audioEngine.selectTrack(track);
    audioRunning = true;
    updateAudioUI();
    log('Audio started: ' + track);
  } catch (e) {
    log('ERR: ' + e.message);
  }
}

function stopAudio() {
  audioEngine.stop();
  audioRunning = false;
  updateAudioUI();
  log('Audio stopped');
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
}

function onTrackChange() {
  const track = document.getElementById('track-select').value;
  if (audioRunning) {
    audioEngine.selectTrack(track);
    log('Switched to: ' + track);
  }
  wsClient.send({ action: 'track', name: track });
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
let sensTimer = null;
function onSensitivityChange(rawVal) {
  const pct = parseInt(rawVal);
  document.getElementById('sensitivity-label').textContent = pct + '%';
  if (sensTimer) clearTimeout(sensTimer);
  sensTimer = setTimeout(() => {
    wsClient.send({ action: 'sensitivity', value: pct / 100 });
  }, 200);
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
  const url = 'https://polymarket.com/event/' + (eventSlug || slug);
  wsClient.send({ action: 'play_url', url });
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
  const first = tabs.querySelector('.browse-tab');
  if (first) browseTab(first);
}

async function browseTab(btn) {
  document.querySelectorAll('.browse-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tagId = btn.dataset.tag;
  const sort = btn.dataset.sort;
  const cacheKey = tagId + ':' + sort;
  activeTab = cacheKey;

  if (browseCache[cacheKey] && tagId !== 'live') {
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
      + '<div class="browse-question">' + esc((m.question || '').substring(0, 65)) + '</div>'
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
  ad.className = 'dot ' + (audioRunning ? 'dot-on' : 'dot-off');
  const track = document.getElementById('track-select').value;
  document.getElementById('audio-label').textContent = audioRunning ? 'Playing: ' + track : 'Stopped';
}

function onWsStatus(data) {
  // Populate track selector
  const sel = document.getElementById('track-select');
  if (sel.options.length === 0 && data.tracks) {
    const groups = {};
    data.tracks.forEach(t => {
      const cat = t.category || 'music';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });
    const order = [['music', 'Music'], ['alert', 'Alerts']];
    order.forEach(([key, label]) => {
      if (!groups[key]) return;
      const og = document.createElement('optgroup');
      og.label = label;
      groups[key].forEach(t => og.add(new Option(t.label, t.name)));
      sel.add(og);
    });
  }
  // Init browse tabs
  if (data.categories) {
    initBrowse(data.categories);
  }
}

function onWsMarketData(data) {
  // Update now-playing display
  const np = document.getElementById('np');
  if (np.style.display !== '') {
    // Market data received but no market_info yet — just update values
  }
  if (np.style.display === 'none') return;

  const mood = document.getElementById('np-mood');
  const pct = (data.price * 100).toFixed(1);
  const toneStr = data.tone === 1 ? 'bullish' : 'bearish';
  mood.textContent = toneStr.toUpperCase() + '  ' + pct + '%';
  mood.className = 'np-mood ' + toneStr;

  document.getElementById('np-osc').innerHTML = [
    ['HEAT', data.heat], ['PRICE', data.price], ['VELOCITY', data.velocity],
    ['TRADE RATE', data.trade_rate], ['SPREAD', data.spread], ['TONE', data.tone ? 'MAJ' : 'MIN']
  ].map(([l, v]) => '<div class="osc-cell"><div class="lbl">' + l + '</div><div class="val">' + v + '</div></div>').join('');

  // Feed data to audio engine
  if (audioRunning) {
    audioEngine.onMarketData(data);
  }
}

function onWsMarketInfo(market) {
  const np = document.getElementById('np');
  if (!market) {
    np.style.display = 'none';
    currentMarketSlug = null;
    if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
    return;
  }
  np.style.display = '';
  currentMarketSlug = market.slug;
  document.getElementById('np-question').textContent = market.question;
  const npLink = document.getElementById('np-link');
  if (market.link) {
    npLink.href = market.link;
    npLink.style.display = '';
  } else {
    npLink.style.display = 'none';
  }
  document.getElementById('url-status').textContent = '';
  log('Now playing: ' + market.question);
  if (activeTab && browseCache[activeTab]) renderBrowse(browseCache[activeTab]);
}

function onWsEvent(msg) {
  if (audioRunning) {
    audioEngine.handleEvent(msg);
  }
  if (msg.event === 'spike') log('Event: heat spike');
  if (msg.event === 'price_move') log('Event: price ' + (msg.direction > 0 ? 'up' : 'down'));
  if (msg.event === 'resolved') log('Event: market resolved (' + (msg.result > 0 ? 'Yes' : 'No') + ')');
}

function onWsConnected() {
  document.getElementById('ws-dot').className = 'dot dot-on';
  document.getElementById('ws-label').textContent = 'Connected';
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
}

// ── Init ──
log('Ready. Pick a market to play, or paste a Polymarket URL.');
wsClient.connect();
