"""
Polymarket Bar — Live Debug Console
Runs the full DJ pipeline with rich terminal output showing:
  - Market data feed events
  - Heat scores and layer assignments
  - OSC messages being sent to Sonic Pi
  - Connection status
"""
import asyncio
import sys
import time

sys.stdout.reconfigure(line_buffering=True)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from polymarket.scorer import MarketScorer
from polymarket.websocket import PolymarketFeed
from mixer.mixer import AutonomousDJ
from osc.bridge import OSCBridge, SLOT_OSC_MAP
from config import RESCORE_INTERVAL


# ── Logging wrappers ──────────────────────────────────────

def ts():
    return time.strftime("%H:%M:%S")


class LoggingOSCBridge(OSCBridge):
    """OSCBridge that logs every message sent."""

    def push_market_params(self, slot, asset_id):
        if slot not in SLOT_OSC_MAP:
            return

        prefix = SLOT_OSC_MAP[slot]
        heat = self.scorer.heat(asset_id)
        vel = self.scorer.price_velocity(asset_id)
        rate = self.scorer.trade_rate(asset_id)
        bid, ask = self.scorer.spreads[asset_id]
        price = list(self.scorer.price_history[asset_id])
        last_price = price[-1][1] if price else 0.5

        from osc.bridge import _scale
        amp = _scale(heat, 0, 1, 0.2, 1.4)
        cutoff = _scale(last_price, 0, 1, 60, 115)
        reverb = _scale(vel, 0, 1, 0.1, 0.85)
        density = _scale(rate, 0, 1, 0.1, 1.0)
        tone = 1 if last_price >= 0.5 else 0
        tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)

        print(f"  [OSC {ts()}] {prefix:12s}  amp={amp:.2f}  cut={cutoff:.0f}  rev={reverb:.2f}  "
              f"den={density:.2f}  tone={tone}  ten={tension:.2f}  (heat={heat:.2f} price={last_price:.3f})",
              flush=True)

        self.client.send_message(f"{prefix}/amp", amp)
        self.client.send_message(f"{prefix}/cutoff", cutoff)
        self.client.send_message(f"{prefix}/reverb", reverb)
        self.client.send_message(f"{prefix}/density", density)
        self.client.send_message(f"{prefix}/tone", tone)
        self.client.send_message(f"{prefix}/tension", tension)

    def send_layer_command(self, slot, asset_id, command):
        prefix = SLOT_OSC_MAP.get(slot, "/btc/unknown")
        print(f"  [OSC {ts()}] {prefix}/command = {command}", flush=True)
        super().send_layer_command(slot, asset_id, command)

    def send_global(self, key, value):
        print(f"  [OSC {ts()}] /btc/global/{key} = {value}", flush=True)
        super().send_global(key, value)


class LoggingScorer(MarketScorer):
    """MarketScorer that logs trade/price events."""

    def __init__(self):
        super().__init__()
        self._event_count = 0
        self._last_log = time.time()

    def on_price_change(self, market_id, price):
        super().on_price_change(market_id, price)
        self._event_count += 1
        self._maybe_log_rate()

    def on_trade(self, market_id):
        super().on_trade(market_id)
        self._event_count += 1

    def on_best_bid_ask(self, market_id, bid, ask):
        super().on_best_bid_ask(market_id, bid, ask)

    def _maybe_log_rate(self):
        now = time.time()
        if now - self._last_log >= 10:
            rate = self._event_count / (now - self._last_log)
            print(f"  [FEED {ts()}] {self._event_count} events in {now - self._last_log:.0f}s "
                  f"({rate:.1f}/s)", flush=True)
            self._event_count = 0
            self._last_log = now


class LoggingFeed(PolymarketFeed):
    """PolymarketFeed that logs connection events."""

    async def connect(self):
        print(f"[FEED {ts()}] Connecting to WebSocket...", flush=True)
        await super().connect()


# ── Main ──────────────────────────────────────────────────

async def param_push_loop(dj, interval=3.0):
    """Continuously push market params to Sonic Pi."""
    while True:
        await asyncio.sleep(interval)
        if dj.layers:
            print(f"\n  [PUSH {ts()}] Sending params for {len(dj.layers)} layers:", flush=True)
            for slot, layer in dj.layers.items():
                try:
                    dj.osc.push_market_params(slot, layer["asset_id"])
                except Exception as e:
                    print(f"  [PUSH {ts()}] ERROR [{slot}]: {e}", flush=True)


async def status_loop(dj, scorer, interval=15.0):
    """Periodic status summary."""
    while True:
        await asyncio.sleep(interval)
        active = len(dj.layers)
        tracked = len(scorer.trade_times)
        total_trades = sum(len(v) for v in scorer.trade_times.values())
        print(f"\n{'='*65}", flush=True)
        print(f"  [STATUS {ts()}] Layers={active}  Tracked markets={tracked}  "
              f"Recent trades={total_trades}", flush=True)
        if dj.layers:
            print(f"  {'Slot':12s}  {'Heat':>5s}  {'Trades':>6s}  Market", flush=True)
            print(f"  {'-'*12}  {'-'*5}  {'-'*6}  {'-'*35}", flush=True)
            for slot, layer in dj.layers.items():
                aid = layer["asset_id"]
                heat = scorer.heat(aid)
                trades = len([t for t in scorer.trade_times[aid] if time.time() - t < 60])
                q = layer["question"][:40]
                print(f"  {slot:12s}  {heat:5.2f}  {trades:6d}  {q}", flush=True)
        print(f"{'='*65}\n", flush=True)


async def main():
    print("""
    +==========================================+
    |    THE POLYMARKET BAR -- DEBUG CONSOLE    |
    |  Sonic predictions. Real-time. Always.   |
    +==========================================+
    """, flush=True)
    print(f"[INIT {ts()}] Starting up...", flush=True)
    print(f"[INIT {ts()}] OSC target: 127.0.0.1:4560", flush=True)
    print(f"[INIT {ts()}] Rescore interval: {RESCORE_INTERVAL}s", flush=True)

    scorer = LoggingScorer()
    osc = LoggingOSCBridge(scorer)

    import polymarket.gamma as gamma_module
    dj = AutonomousDJ(scorer, None, osc, gamma_module)
    feed = LoggingFeed(scorer, on_resolution=dj.on_market_resolved)
    dj.feed = feed

    print(f"[INIT {ts()}] Fetching initial markets...", flush=True)

    await asyncio.gather(
        feed.connect(),
        dj.run(),
        param_push_loop(dj, interval=5.0),
        status_loop(dj, scorer, interval=15.0),
    )


if __name__ == "__main__":
    asyncio.run(main())
