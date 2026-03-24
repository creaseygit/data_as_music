# The Polymarket Bar — Generative Music Stream Spec

> *Background music for a bar full of screens monitoring the world's collective uncertainty. The music is loudest when the world is most unpredictable.*

The system is an autonomous DJ. It listens to every trade, every price move, every market resolution across Polymarket in real time, scores markets by heat, and continuously mixes the music toward whatever the crowd is betting on most furiously. When an election is being called, you hear it. When a market resolves, you feel it. When nothing is happening, the room breathes.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    POLYMARKET APIs                       │
│                                                         │
│  Gamma REST API          CLOB WebSocket                 │
│  (market discovery,  →   (real-time price changes,      │
│   volume, metadata)       trades, resolutions)          │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  PYTHON BRAIN                           │
│                                                         │
│  Market Scorer       Live Mixer        OSC Bridge       │
│  (volatility +   →   (fade in/out  →   (sends params    │
│   volume rank)        transitions)      to Sonic Pi)    │
└─────────────────────┬───────────────────────────────────┘
                      │ OSC
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  SONIC PI                               │
│  Kick · Bass · Pad · Lead · FX · Atmosphere             │
│  Each layer independently driven by a market            │
└─────────────────────┬───────────────────────────────────┘
                      │ Virtual Audio Cable / BlackHole
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  OBS STUDIO                             │
│  Audio capture + overlay (now playing market names)     │
└─────────────────────┬───────────────────────────────────┘
                      │ RTMP
                      ▼
                YouTube Live (24/7)
```

---

## Project Structure

```
polymarket-bar/
│
├── main.py                        # Entry point, orchestrates everything
├── config.py                      # Tunable parameters
├── requirements.txt
│
├── polymarket/
│   ├── gamma.py                   # Gamma REST API — market discovery
│   ├── websocket.py               # CLOB WebSocket — real-time feed
│   └── scorer.py                  # Market heat scoring engine
│
├── mixer/
│   ├── mixer.py                   # Autonomous DJ logic
│   ├── transitions.py             # Crossfade / mix-in / mix-out logic
│   └── state.py                   # Current playing state
│
├── osc/
│   └── bridge.py                  # Maps market state → Sonic Pi params
│
├── sonic_pi/
│   └── bar_track.rb               # The Sonic Pi generative track
│
└── stream/
    └── obs_setup.md               # OBS overlay + stream key setup
```

---

## config.py

```python
# ── Polymarket ───────────────────────────────────────────
GAMMA_API      = "https://gamma-api.polymarket.com"
CLOB_WS        = "wss://ws-subscriptions-clob.polymarket.com/ws/market"

# How often to re-score and potentially re-mix (seconds)
RESCORE_INTERVAL   = 30
MARKET_FETCH_LIMIT = 50          # pull top N active markets to score from

# ── Mixer ────────────────────────────────────────────────
MAX_ACTIVE_LAYERS  = 5           # simultaneous market→instrument mappings
MIN_ACTIVE_LAYERS  = 2           # floor — always keep something playing
SWAP_THRESHOLD     = 0.25        # score delta before triggering a swap
FADE_BARS          = 8           # crossfade duration in musical bars

# ── Instruments (one per layer slot) ─────────────────────
LAYER_INSTRUMENTS  = ["kick", "bass", "pad", "lead", "atmosphere"]

# ── Scoring weights ──────────────────────────────────────
WEIGHT_PRICE_VELOCITY = 0.35
WEIGHT_TRADE_RATE     = 0.40
WEIGHT_VOLUME         = 0.15
WEIGHT_SPREAD         = 0.10

# Minimum trade events per minute to be considered "alive"
MIN_TRADE_RATE     = 2

# ── OSC ──────────────────────────────────────────────────
OSC_IP   = "127.0.0.1"
OSC_PORT = 4560

# ── Ambient fallback ─────────────────────────────────────
# Triggered when no markets exceed MIN_TRADE_RATE
AMBIENT_MODE_THRESHOLD = 1       # active markets below this → go ambient

# ── Request mode (Phase 2) ───────────────────────────────
# Allow a specific market to be pinned as the lead layer
PINNED_MARKET_SLUG = None        # e.g. "will-trump-veto-the-bill"
```

---

## polymarket/gamma.py — Market Discovery

Polls the Gamma REST API periodically to get a fresh ranked list of active markets.

```python
import requests
from config import GAMMA_API, MARKET_FETCH_LIMIT

def fetch_active_markets(tag: str = None) -> list[dict]:
    """
    Fetch currently active Polymarket markets ordered by volume.
    Returns a list of dicts with id, slug, question, volume, asset_ids.
    """
    params = {
        "active": "true",
        "closed": "false",
        "order": "volume24hr",
        "ascending": "false",
        "limit": MARKET_FETCH_LIMIT,
    }
    if tag:
        params["tag"] = tag

    resp = requests.get(f"{GAMMA_API}/markets", params=params, timeout=10)
    resp.raise_for_status()
    markets = resp.json()

    return [
        {
            "id":        m["id"],
            "slug":      m.get("slug", ""),
            "question":  m.get("question", "Unknown market"),
            "volume":    float(m.get("volume24hr") or 0),
            "asset_ids": m.get("clobTokenIds", []),
            "end_date":  m.get("endDate"),
            "tags":      [t.get("slug") for t in m.get("tags", [])],
        }
        for m in markets
        if m.get("clobTokenIds")   # must have tradeable tokens
    ]


def fetch_market_by_slug(slug: str) -> dict | None:
    """Fetch a specific market by slug — used for request/pin mode."""
    resp = requests.get(f"{GAMMA_API}/markets", params={"slug": slug}, timeout=10)
    markets = resp.json()
    return markets[0] if markets else None
```

---

## polymarket/scorer.py — Market Heat Engine

The brain of the autonomous DJ. Scores every market we're watching in real time.

```python
import time
from collections import defaultdict, deque
from config import (
    WEIGHT_PRICE_VELOCITY, WEIGHT_TRADE_RATE,
    WEIGHT_VOLUME, WEIGHT_SPREAD, MIN_TRADE_RATE
)

class MarketScorer:
    """
    Tracks real-time signals for each market and produces a
    normalised heat score between 0.0 and 1.0.
    """

    def __init__(self):
        # price history: market_id → deque of (timestamp, price)
        self.price_history  = defaultdict(lambda: deque(maxlen=20))
        # trade events: market_id → deque of timestamps
        self.trade_times    = defaultdict(lambda: deque(maxlen=100))
        # best bid/ask: market_id → (bid, ask)
        self.spreads        = defaultdict(lambda: (0.4, 0.6))
        # 24h volume from Gamma REST (static per fetch cycle)
        self.volumes        = defaultdict(float)

    # ── Feed methods (called by WebSocket handler) ────────

    def on_price_change(self, market_id: str, price: float):
        self.price_history[market_id].append((time.time(), price))

    def on_trade(self, market_id: str):
        self.trade_times[market_id].append(time.time())

    def on_best_bid_ask(self, market_id: str, bid: float, ask: float):
        self.spreads[market_id] = (bid, ask)

    def set_volume(self, market_id: str, volume: float):
        self.volumes[market_id] = volume

    # ── Scoring ───────────────────────────────────────────

    def price_velocity(self, market_id: str, window: int = 300) -> float:
        """Rate of price change over last `window` seconds. Returns 0–1."""
        history = list(self.price_history[market_id])
        now = time.time()
        recent = [(t, p) for t, p in history if now - t < window]
        if len(recent) < 2:
            return 0.0
        prices = [p for _, p in recent]
        return min(1.0, abs(prices[-1] - prices[0]) / max(prices[0], 0.01))

    def trade_rate(self, market_id: str, window: int = 60) -> float:
        """Trades per minute over last `window` seconds. Returns 0–1."""
        now = time.time()
        recent = [t for t in self.trade_times[market_id] if now - t < window]
        rate = len(recent)  # trades in last minute
        return min(1.0, rate / 20.0)   # 20 trades/min = full score

    def spread_score(self, market_id: str) -> float:
        """Tight spread = active market. Returns 0–1 (higher = tighter)."""
        bid, ask = self.spreads[market_id]
        spread = ask - bid
        return max(0.0, 1.0 - (spread / 0.2))   # 0.2 spread = 0 score

    def volume_score(self, market_id: str, max_volume: float = 1_000_000) -> float:
        """Normalised 24h volume. Returns 0–1."""
        return min(1.0, self.volumes.get(market_id, 0) / max_volume)

    def heat(self, market_id: str) -> float:
        """Composite heat score 0.0–1.0."""
        # Dead market floor check
        if self.trade_rate(market_id) < (MIN_TRADE_RATE / 20.0):
            return 0.0

        return (
            self.price_velocity(market_id) * WEIGHT_PRICE_VELOCITY +
            self.trade_rate(market_id)     * WEIGHT_TRADE_RATE     +
            self.volume_score(market_id)   * WEIGHT_VOLUME         +
            self.spread_score(market_id)   * WEIGHT_SPREAD
        )

    def rank(self, market_ids: list[str]) -> list[tuple[str, float]]:
        """Return markets sorted by heat, highest first."""
        scored = [(mid, self.heat(mid)) for mid in market_ids]
        return sorted(scored, key=lambda x: x[1], reverse=True)
```

---

## polymarket/websocket.py — Real-time Feed

```python
import asyncio
import json
import websockets
from config import CLOB_WS

class PolymarketFeed:
    """
    Manages a single persistent WebSocket connection to Polymarket's
    CLOB market channel. Dispatches events to registered handlers.
    """

    def __init__(self, scorer, on_resolution=None):
        self.scorer        = scorer
        self.on_resolution = on_resolution     # callback for market_resolved
        self.subscribed    = set()
        self._ws           = None

    async def connect(self):
        while True:
            try:
                async with websockets.connect(CLOB_WS, ping_interval=10) as ws:
                    self._ws = ws
                    print("[WS] Connected to Polymarket feed")

                    # Re-subscribe after reconnect
                    if self.subscribed:
                        await self._subscribe(list(self.subscribed))

                    async for raw in ws:
                        if raw in ("{}", ""):     # ping/pong
                            await ws.send("{}")
                            continue
                        try:
                            self._dispatch(json.loads(raw))
                        except json.JSONDecodeError:
                            pass
            except Exception as e:
                print(f"[WS] Disconnected: {e} — reconnecting in 5s")
                await asyncio.sleep(5)

    async def _subscribe(self, asset_ids: list[str]):
        if self._ws and asset_ids:
            await self._ws.send(json.dumps({
                "assets_ids": asset_ids,
                "type": "market"
            }))

    async def update_subscriptions(self, add: list[str], remove: list[str]):
        """Dynamically swap markets without reconnecting."""
        if remove:
            self.subscribed -= set(remove)
            await self._ws.send(json.dumps({
                "operation": "unsubscribe",
                "assets_ids": remove
            }))
        if add:
            self.subscribed |= set(add)
            await self._ws.send(json.dumps({
                "operation": "subscribe",
                "assets_ids": add
            }))

    def _dispatch(self, msg: dict):
        etype = msg.get("event_type")

        if etype == "price_change":
            for change in msg.get("price_changes", []):
                self.scorer.on_price_change(
                    change["asset_id"], float(change["price"])
                )
                self.scorer.on_trade(change["asset_id"])

        elif etype == "last_trade_price":
            self.scorer.on_trade(msg["asset_id"])

        elif etype == "best_bid_ask":
            self.scorer.on_best_bid_ask(
                msg["asset_id"],
                float(msg["best_bid"]),
                float(msg["best_ask"])
            )

        elif etype == "market_resolved":
            if self.on_resolution:
                self.on_resolution(msg)
```

---

## mixer/mixer.py — The Autonomous DJ

This is the creative heart. It continuously scores markets, decides what to play, and triggers smooth musical transitions.

```python
import asyncio
import time
from config import (
    MAX_ACTIVE_LAYERS, MIN_ACTIVE_LAYERS, SWAP_THRESHOLD,
    LAYER_INSTRUMENTS, RESCORE_INTERVAL, PINNED_MARKET_SLUG
)

class AutonomousDJ:
    """
    Continuously monitors market heat scores and live-mixes
    the music by mapping hot markets to instrument layers.
    """

    def __init__(self, scorer, feed, osc_bridge, gamma):
        self.scorer     = scorer
        self.feed       = feed
        self.osc        = osc_bridge
        self.gamma      = gamma

        # layer_slot → {market_id, question, asset_id, amp}
        self.layers     = {}
        # All known markets (refreshed from Gamma periodically)
        self.all_markets = []
        # Pinned market slug (request mode)
        self.pinned_slug = PINNED_MARKET_SLUG

    # ── Public control ────────────────────────────────────

    def pin_market(self, slug: str):
        """Force lead layer to a specific market (request mode)."""
        self.pinned_slug = slug
        print(f"[DJ] Pinned market: {slug}")

    def unpin(self):
        self.pinned_slug = None

    # ── Main loop ─────────────────────────────────────────

    async def run(self):
        # Initial market fetch
        await self._refresh_markets()

        while True:
            await asyncio.sleep(RESCORE_INTERVAL)
            await self._refresh_markets()
            await self._mix()
            self._log_now_playing()

    async def _refresh_markets(self):
        """Pull fresh market list from Gamma, update scorer volumes."""
        try:
            markets = self.gamma.fetch_active_markets()
            self.all_markets = markets

            # Register volumes with scorer
            for m in markets:
                for asset_id in m["asset_ids"]:
                    self.scorer.set_volume(asset_id, m["volume"])

            # Make sure we're subscribed to all asset_ids
            all_asset_ids = [
                aid for m in markets for aid in m["asset_ids"]
            ]
            new_ids = [
                aid for aid in all_asset_ids
                if aid not in self.feed.subscribed
            ]
            if new_ids:
                await self.feed.update_subscriptions(add=new_ids, remove=[])

        except Exception as e:
            print(f"[DJ] Market refresh failed: {e}")

    async def _mix(self):
        """Core mixing decision: figure out what should be playing."""
        if not self.all_markets:
            return

        # Score all asset_ids
        all_asset_ids = [
            aid for m in self.all_markets for aid in m["asset_ids"]
        ]
        ranked = self.scorer.rank(all_asset_ids)
        hot    = [(aid, score) for aid, score in ranked if score > 0]

        if not hot:
            self._enter_ambient_mode()
            return

        # Handle pinned market (request mode) — always gets lead slot
        target_layers = {}

        if self.pinned_slug:
            pinned = next(
                (m for m in self.all_markets if m["slug"] == self.pinned_slug),
                None
            )
            if pinned and pinned["asset_ids"]:
                target_layers["lead"] = pinned["asset_ids"][0]

        # Fill remaining slots with hottest markets
        available_slots = [
            inst for inst in LAYER_INSTRUMENTS
            if inst not in target_layers
        ]
        used_ids = set(target_layers.values())

        for slot, (asset_id, score) in zip(available_slots, hot):
            if asset_id in used_ids:
                continue
            if len(target_layers) >= MAX_ACTIVE_LAYERS:
                break
            target_layers[slot] = asset_id
            used_ids.add(asset_id)

        # Apply changes — fade out dropped layers, fade in new ones
        for slot in LAYER_INSTRUMENTS:
            current = self.layers.get(slot, {}).get("asset_id")
            target  = target_layers.get(slot)

            if current == target:
                continue   # no change needed

            if current and not target:
                await self._fade_out(slot)
            elif not current and target:
                await self._fade_in(slot, target)
            else:
                # Crossfade: old → new
                score_current = self.scorer.heat(current) if current else 0
                score_target  = self.scorer.heat(target)  if target  else 0
                if abs(score_target - score_current) > SWAP_THRESHOLD:
                    await self._crossfade(slot, current, target)

    async def _fade_in(self, slot: str, asset_id: str):
        market = self._find_market(asset_id)
        question = market["question"] if market else asset_id[:16]
        print(f"[DJ] ▶ Fading IN  [{slot}] → {question}")
        self.layers[slot] = {"asset_id": asset_id, "question": question, "amp": 0.0}
        self.osc.send_layer_command(slot, asset_id, "fade_in")

    async def _fade_out(self, slot: str):
        layer = self.layers.get(slot, {})
        print(f"[DJ] ◀ Fading OUT [{slot}] ← {layer.get('question', '?')}")
        self.osc.send_layer_command(slot, None, "fade_out")
        if slot in self.layers:
            del self.layers[slot]

    async def _crossfade(self, slot: str, old_id: str, new_id: str):
        market = self._find_market(new_id)
        question = market["question"] if market else new_id[:16]
        print(f"[DJ] ↔ Crossfade [{slot}] → {question}")
        self.osc.send_layer_command(slot, new_id, "crossfade")
        self.layers[slot] = {"asset_id": new_id, "question": question, "amp": 1.0}

    def _enter_ambient_mode(self):
        print("[DJ] 💤 Ambient mode — no hot markets")
        self.osc.send_global("ambient_mode", 1)

    def _find_market(self, asset_id: str) -> dict | None:
        for m in self.all_markets:
            if asset_id in m["asset_ids"]:
                return m
        return None

    def _log_now_playing(self):
        print("\n── Now Playing ──────────────────────────────")
        for slot, layer in self.layers.items():
            heat = self.scorer.heat(layer["asset_id"])
            print(f"  [{slot:12s}] heat={heat:.2f}  {layer['question'][:60]}")
        print("─────────────────────────────────────────────\n")

    # ── Resolution handler ────────────────────────────────

    def on_market_resolved(self, msg: dict):
        """Called when a market resolves. Triggers musical moment."""
        winning = msg.get("winning_outcome", "?")
        question = msg.get("question", "A market")
        print(f"[RESOLVED] {question} → {winning}")

        # Trigger dramatic musical event via OSC
        self.osc.send_global("market_resolved", 1 if winning == "Yes" else -1)

        # Remove resolved market from layers
        resolved_ids = set(msg.get("assets_ids", []))
        for slot, layer in list(self.layers.items()):
            if layer["asset_id"] in resolved_ids:
                asyncio.create_task(self._fade_out(slot))
```

---

## osc/bridge.py — Musical Parameter Mapping

Maps Polymarket market state to Sonic Pi musical parameters.

```python
from pythonosc import udp_client
from config import OSC_IP, OSC_PORT
from polymarket.scorer import MarketScorer

# Instrument slot → Sonic Pi OSC address prefix
SLOT_OSC_MAP = {
    "kick":        "/btc/kick",
    "bass":        "/btc/bass",
    "pad":         "/btc/pad",
    "lead":        "/btc/lead",
    "atmosphere":  "/btc/atmos",
}

class OSCBridge:
    def __init__(self, scorer: MarketScorer):
        self.client  = udp_client.SimpleUDPClient(OSC_IP, OSC_PORT)
        self.scorer  = scorer

    def push_market_params(self, slot: str, asset_id: str):
        """
        Derive musical parameters from a market's live state
        and send them to Sonic Pi via OSC.
        """
        if slot not in SLOT_OSC_MAP:
            return

        prefix = SLOT_OSC_MAP[slot]
        heat   = self.scorer.heat(asset_id)
        vel    = self.scorer.price_velocity(asset_id)
        rate   = self.scorer.trade_rate(asset_id)
        bid, ask = self.scorer.spreads[asset_id]
        price  = list(self.scorer.price_history[asset_id])
        last_price = price[-1][1] if price else 0.5

        # ── Musical mappings ──────────────────────────────

        # Overall energy of this layer
        amp     = _scale(heat, 0, 1, 0.2, 1.4)
        # Filter brightness — overbought markets sound bright
        cutoff  = _scale(last_price, 0, 1, 60, 115)
        # Reverb room — volatile markets sound spacious
        reverb  = _scale(vel, 0, 1, 0.1, 0.85)
        # Note density — trade rate drives rhythmic density
        density = _scale(rate, 0, 1, 0.1, 1.0)
        # Tonality — above 0.5 probability = major, below = minor
        tone    = 1 if last_price >= 0.5 else 0
        # Spread drives dissonance — wide spread = tense harmony
        tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)

        self.client.send_message(f"{prefix}/amp",     amp)
        self.client.send_message(f"{prefix}/cutoff",  cutoff)
        self.client.send_message(f"{prefix}/reverb",  reverb)
        self.client.send_message(f"{prefix}/density", density)
        self.client.send_message(f"{prefix}/tone",    tone)
        self.client.send_message(f"{prefix}/tension", tension)

    def send_layer_command(self, slot: str, asset_id: str | None, command: str):
        """Send a transition command to Sonic Pi."""
        prefix = SLOT_OSC_MAP.get(slot, "/btc/unknown")
        self.client.send_message(f"{prefix}/command", command)
        if asset_id:
            self.push_market_params(slot, asset_id)

    def send_global(self, key: str, value):
        """Send a global event — market resolution, ambient mode etc."""
        self.client.send_message(f"/btc/global/{key}", value)


def _scale(val, in_lo, in_hi, out_lo, out_hi):
    n = max(0.0, min(1.0, (val - in_lo) / max(in_hi - in_lo, 0.0001)))
    return out_lo + n * (out_hi - out_lo)
```

---

## sonic_pi/bar_track.rb — The Music

Five independent instrument layers. Each listens to its own OSC namespace. When a market fades in, that layer wakes up. When it fades out, it goes quiet. A resolved market triggers a dramatic musical event.

```ruby
# Polymarket Bar — Sonic Pi generative track
# Each live_loop is an independent instrument layer
# driven by a different Polymarket market via OSC

use_debug false
use_bpm 124

# ─── Global state ─────────────────────────────────────────
set :global_bpm,      124
set :market_resolved, 0     # 1=yes resolved, -1=no resolved
set :ambient_mode,    0

# ─── Global OSC listeners ─────────────────────────────────
live_loop :global_listener do
  use_real_time
  b = sync "/osc*/btc/global/bpm";             set :global_bpm,      b[0] rescue nil
  r = sync "/osc*/btc/global/market_resolved"; set :market_resolved, r[0] rescue nil
  a = sync "/osc*/btc/global/ambient_mode";    set :ambient_mode,    a[0] rescue nil
end

# ─── Layer state initialisation ───────────────────────────
[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  set :"#{layer}_amp",     0.0
  set :"#{layer}_cutoff",  80.0
  set :"#{layer}_reverb",  0.3
  set :"#{layer}_density", 0.5
  set :"#{layer}_tone",    1
  set :"#{layer}_tension", 0.0
end

# ─── Per-layer OSC listeners ──────────────────────────────
[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  live_loop :"#{layer}_listener" do
    use_real_time
    prefix = "/osc*/btc/#{layer}"

    a = sync "#{prefix}/amp";     set :"#{layer}_amp",     a[0] rescue nil
    c = sync "#{prefix}/cutoff";  set :"#{layer}_cutoff",  c[0] rescue nil
    r = sync "#{prefix}/reverb";  set :"#{layer}_reverb",  r[0] rescue nil
    d = sync "#{prefix}/density"; set :"#{layer}_density", d[0] rescue nil
    t = sync "#{prefix}/tone";    set :"#{layer}_tone",    t[0] rescue nil
    x = sync "#{prefix}/tension"; set :"#{layer}_tension", x[0] rescue nil

    cmd = sync "#{prefix}/command" rescue nil
    if cmd
      case cmd[0]
      when "fade_in"
        # Smoothly ramp amp from 0 to target over FADE_BARS
        set :"#{layer}_amp", 0.0
      when "fade_out"
        set :"#{layer}_amp", 0.0
      end
    end
  end
end

# ─── KICK — market: activity rate drives pattern density ───
live_loop :kick do
  use_bpm get(:global_bpm)
  amp     = get(:kick_amp)
  density = get(:kick_density)

  next sleep(1) if amp < 0.05

  # Four-on-the-floor baseline, with density adding ghost hits
  pattern = [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0]
  ghost   = density > 0.6 ? [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,1,0,0] : Array.new(16, 0)

  16.times do |i|
    sample :bd_haus, amp: amp * (pattern[i] == 1 ? 1.0 : 0.0)
    sample :bd_haus, amp: amp * 0.4 if ghost[i] == 1
    sleep 0.25
  end
end

# ─── BASS — market probability drives root note ────────────
live_loop :bass do
  use_bpm get(:global_bpm)
  amp     = get(:bass_amp)
  cutoff  = get(:bass_cutoff)
  tone    = get(:bass_tone)
  tension = get(:bass_tension)

  next sleep(1) if amp < 0.05

  use_synth :tb303
  root = tone == 1 ? :e2 : :d2    # yes-heavy market = E minor, no-heavy = D minor

  notes = tension > 0.5 ?
    chord(root, :diminished) :     # high spread = tense harmony
    chord(root, :minor)

  with_fx :lpf, cutoff: cutoff do
    with_fx :distortion, distort: tension * 0.3 do
      play notes.choose,
        release: [0.25, 0.5, 0.5, 1.0].choose,
        amp: amp * 0.9
    end
  end
  sleep [0.25, 0.5, 0.5, 0.5, 1.0].choose
end

# ─── PAD — price velocity drives reverb/space ──────────────
live_loop :pad do
  use_bpm get(:global_bpm)
  amp    = get(:pad_amp)
  reverb = get(:pad_reverb)
  tone   = get(:pad_tone)
  cutoff = get(:pad_cutoff)

  next sleep(4) if amp < 0.05

  use_synth :hollow
  scale_name = tone == 1 ? :minor : :phrygian   # minor=balanced, phrygian=doom

  with_fx :reverb, room: reverb, mix: 0.7 do
    with_fx :lpf, cutoff: cutoff + 5 do
      play scale(:e3, scale_name).choose,
        attack: 1.5, release: 3.0,
        amp: amp * 0.35
    end
  end
  sleep 8
end

# ─── LEAD — trade rate drives melodic activity ─────────────
live_loop :lead do
  use_bpm get(:global_bpm)
  amp     = get(:lead_amp)
  density = get(:lead_density)
  cutoff  = get(:lead_cutoff)
  tone    = get(:lead_tone)

  next sleep(0.5) if amp < 0.05

  use_synth :blade
  scale_notes = scale(:e4, tone == 1 ? :minor_pentatonic : :hungarian_minor)

  # High density markets get fast melodic bursts
  steps = density > 0.7 ? [0.25, 0.25, 0.5] : [0.5, 1.0, 1.0, 2.0]

  with_fx :echo, phase: 0.5, decay: 3, mix: 0.3 do
    with_fx :lpf, cutoff: cutoff + 10 do
      if one_in([2, 3, 4].choose)
        play scale_notes.choose, release: steps.choose, amp: amp * 0.5
      end
    end
  end
  sleep steps.choose
end

# ─── ATMOSPHERE — global heat drives texture ───────────────
live_loop :atmosphere do
  use_bpm get(:global_bpm)
  amp    = get(:atmos_amp)
  reverb = get(:atmos_reverb)

  next sleep(8) if amp < 0.05

  use_synth :dark_ambience
  with_fx :reverb, room: 0.99, mix: 0.85 do
    with_fx :hpf, cutoff: 30 do
      play [:e1, :b1, :e2, :g2].choose,
        attack: 4, release: 8,
        amp: amp * 0.2
    end
  end
  sleep 16
end

# ─── MARKET RESOLVED — dramatic musical event ──────────────
live_loop :resolution_handler do
  use_real_time
  sync "/osc*/btc/global/market_resolved"

  resolved = get(:market_resolved)
  next if resolved == 0

  if resolved == 1
    # YES resolved — triumphant ascending motif
    use_synth :piano
    [:e4, :g4, :b4, :e5].each do |note|
      play note, release: 0.3, amp: 1.2
      sleep 0.25
    end
    play :e5, release: 2.0, amp: 1.0
  else
    # NO resolved — descending bass drop
    use_synth :tb303
    [:b3, :g3, :e3, :b2].each do |note|
      play note, release: 0.4, amp: 1.0, cutoff: 70
      sleep 0.3
    end
  end

  set :market_resolved, 0   # reset
  sleep 4
end

# ─── AMBIENT MODE — quiet background when nothing is hot ───
live_loop :ambient do
  next sleep(8) unless get(:ambient_mode) == 1

  use_synth :dark_ambience
  with_fx :reverb, room: 0.99, mix: 0.9 do
    play scale(:e2, :minor).choose,
      attack: 6, release: 10,
      amp: 0.15
  end
  sleep 20
end
```

---

## main.py — Entry Point

```python
import asyncio
from polymarket.gamma    import fetch_active_markets, fetch_market_by_slug
from polymarket.scorer   import MarketScorer
from polymarket.websocket import PolymarketFeed
from mixer.mixer         import AutonomousDJ
from osc.bridge          import OSCBridge

async def main():
    print("""
    ╔══════════════════════════════════════════╗
    ║      THE POLYMARKET BAR — LIVE MUSIC     ║
    ║  Sonic predictions. Real-time. Always.   ║
    ╚══════════════════════════════════════════╝
    """)

    scorer  = MarketScorer()
    osc     = OSCBridge(scorer)

    import polymarket.gamma as gamma_module
    dj      = AutonomousDJ(scorer, None, osc, gamma_module)
    feed    = PolymarketFeed(scorer, on_resolution=dj.on_market_resolved)
    dj.feed = feed

    # Run WebSocket feed + DJ loop concurrently
    await asyncio.gather(
        feed.connect(),
        dj.run(),
    )

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Data → Music Mapping Reference

| Polymarket Signal | Musical Layer | Parameter |
|---|---|---|
| Market heat score | All layers | Amplitude (louder = hotter) |
| Last trade price (0–1 probability) | Bass, Lead | Root note / key centre |
| Price above 0.5 | Bass, Pad, Lead | Major-leaning scale |
| Price below 0.5 | Bass, Pad, Lead | Minor / phrygian scale |
| Price velocity | Pad | Reverb room size |
| Trade rate per minute | Kick, Lead | Pattern density / melodic activity |
| Bid-ask spread | Bass | Harmonic tension / distortion |
| Volume (24h) | All | Overall layer weight in mix |
| Market resolved YES | Global | Ascending piano motif |
| Market resolved NO | Global | Descending bass drop |
| No hot markets | Global | Ambient mode — room breathes |

---

## OBS Overlay — Now Playing

In OBS, add a **Browser Source** pointing to a local HTML file that reads the DJ state and shows what's currently playing — like a vinyl record sleeve for prediction markets:

```
┌─────────────────────────────────────────────────────────┐
│  🔴 LIVE        THE POLYMARKET BAR                      │
│                                                         │
│  NOW PLAYING                                            │
│  ─────────────────────────────────────────────────      │
│  LEAD   ████████░░  Will Trump veto the spending bill?  │
│  BASS   ██████░░░░  Will Fed cut rates in March?        │
│  PAD    ████░░░░░░  Will BTC hit $100k by April?        │
│  KICK   ███░░░░░░░  Will Nvidia hit $200 this quarter?  │
│                                                         │
│  HEAT   ▓▓▓▓▓▓▓░░░  Market activity: HIGH              │
└─────────────────────────────────────────────────────────┘
```

The Python bridge can write a simple JSON file every few seconds that the browser source polls:

```python
# osc/bridge.py — add this
import json, pathlib

def write_now_playing(self, layers: dict):
    state = {
        slot: {
            "question": layer["question"][:55],
            "heat": round(self.scorer.heat(layer["asset_id"]), 2)
        }
        for slot, layer in layers.items()
    }
    pathlib.Path("now_playing.json").write_text(json.dumps(state))
```

---

## Phase Roadmap

### Phase 1 — Get Sound Playing (Week 1)
- Python fetches top 5 markets from Gamma REST API
- WebSocket subscription to their asset_ids
- Basic OSC → Sonic Pi connection working
- Single market drives the full track
- Stream to YouTube via OBS

### Phase 2 — Autonomous DJ (Week 2–3)
- Scorer running in real time
- Multi-layer mixing working
- Auto-rotation on market resolution
- Now Playing overlay in OBS
- Crossfade transitions smooth

### Phase 3 — Request Mode (Week 4+)
- Simple web UI where viewers paste a Polymarket URL
- System pins that market as the lead layer for N minutes
- Chat bot integration (YouTube Live chat → pin command)
- Eventually: full viewer-facing webpage to browse and vote

---

## requirements.txt

```
python-osc==1.8.3
websockets==12.0
requests==2.31.0
asyncio==3.4.3
```

---

## One-line Summary for Claude Code

> *Build a Python system that connects to Polymarket's public WebSocket API, scores all active markets by real-time heat (price velocity + trade rate + volume), maps the top 5 to instrument layers in Sonic Pi via OSC, and continuously crossfades between them as market activity shifts — with dramatic musical events when markets resolve.*
