import asyncio
import json
import websockets
from config import CLOB_WS


class MarketFeed:
    """
    Manages a single persistent WebSocket connection to the prediction
    market CLOB channel. Dispatches events to registered handlers.
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
                    print("[WS] Connected to market feed")

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
            if self._ws:
                await self._ws.send(json.dumps({
                    "operation": "unsubscribe",
                    "assets_ids": remove
                }))
        if add:
            self.subscribed |= set(add)
            if self._ws:
                await self._ws.send(json.dumps({
                    "operation": "subscribe",
                    "assets_ids": add
                }))

    def _dispatch(self, msg):
        # First message after subscribe is a list (initial book snapshot)
        if isinstance(msg, list):
            for item in msg:
                if isinstance(item, dict):
                    self._dispatch_single(item)
            return
        self._dispatch_single(msg)

    def _dispatch_single(self, msg: dict):
        etype = msg.get("event_type")

        if etype == "price_change":
            for change in msg.get("price_changes", []):
                self.scorer.on_price_change(
                    change["asset_id"], float(change["price"])
                )
                self.scorer.on_trade(change["asset_id"])
                # price_changes also contain best bid/ask info
                if "best_bid" in change and "best_ask" in change:
                    self.scorer.on_best_bid_ask(
                        change["asset_id"],
                        float(change["best_bid"]),
                        float(change["best_ask"])
                    )

        elif etype == "last_trade_price":
            self.scorer.on_trade(msg.get("asset_id", ""))

        elif etype in ("book", "tick_size_change"):
            # Book snapshots — extract best bid/ask from bids/asks arrays
            asset_id = msg.get("asset_id", "")
            bids = msg.get("bids", [])
            asks = msg.get("asks", [])
            if asset_id and bids and asks:
                best_bid = max(float(b["price"]) for b in bids)
                best_ask = min(float(a["price"]) for a in asks)
                self.scorer.on_best_bid_ask(asset_id, best_bid, best_ask)

        elif etype == "market_resolved":
            if self.on_resolution:
                self.on_resolution(msg)
