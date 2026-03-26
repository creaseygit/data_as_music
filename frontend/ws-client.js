// ── WebSocket Client ──────────────────────────────────────
// Connects to the server, dispatches messages to app.js callbacks.

const wsClient = (() => {
  let ws = null;
  let reconnectTimer = null;

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
      console.log('[WS] Connected');
      if (typeof onWsConnected === 'function') onWsConnected();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'status':
            if (typeof onWsStatus === 'function') onWsStatus(msg.data);
            break;
          case 'market_data':
            if (typeof onWsMarketData === 'function') onWsMarketData(msg.data);
            break;
          case 'market_info':
            if (typeof onWsMarketInfo === 'function') onWsMarketInfo(msg.market);
            break;
          case 'event':
            if (typeof onWsEvent === 'function') onWsEvent(msg);
            break;
          case 'error':
            if (typeof onWsError === 'function') onWsError(msg.message);
            break;
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      if (typeof onWsDisconnected === 'function') onWsDisconnected();
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  return { connect, send };
})();
