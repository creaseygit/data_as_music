import asyncio
from config import (
    LAYER_INSTRUMENTS, RESCORE_INTERVAL, SWAP_THRESHOLD,
    PINNED_MARKET_SLUG
)


class AutonomousDJ:
    """
    Single-market DJ: the hottest market drives the entire song.
    All layers respond to the same market's data. When a hotter
    market takes over, everything transitions together.
    """

    def __init__(self, scorer, feed, osc_bridge, gamma):
        self.scorer     = scorer
        self.feed       = feed
        self.osc        = osc_bridge
        self.gamma      = gamma

        # Current market driving the song
        self.current_market = None   # dict: {id, slug, question, volume, asset_ids}
        self.current_asset  = None   # the primary asset_id we're tracking

        # Layer state (all layers use the same market)
        self.layers     = {}
        # All known markets (refreshed from Gamma periodically)
        self.all_markets = []
        # Pinned market slug (request mode)
        self.pinned_slug = PINNED_MARKET_SLUG

    # ── Public control ────────────────────────────────────

    def pin_market(self, slug: str):
        """Force the song to follow a specific market."""
        self.pinned_slug = slug
        print(f"[DJ] Pinned market: {slug}")

    def unpin(self):
        self.pinned_slug = None

    # ── Main loop ─────────────────────────────────────────

    async def run(self):
        await self._refresh_markets()

        while True:
            await asyncio.sleep(RESCORE_INTERVAL)
            await self._refresh_markets()
            await self._mix()
            self._log_now_playing()
            self.osc.write_now_playing(self.layers)

    async def _refresh_markets(self):
        """Pull fresh market list from Gamma, update scorer volumes."""
        try:
            markets = self.gamma.fetch_active_markets()
            self.all_markets = markets

            for m in markets:
                for asset_id in m["asset_ids"]:
                    self.scorer.set_volume(asset_id, m["volume"])

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
        """Pick the single hottest market and drive the whole song with it."""
        if not self.all_markets:
            return

        # Score all asset_ids
        all_asset_ids = [
            aid for m in self.all_markets for aid in m["asset_ids"]
        ]
        ranked = self.scorer.rank(all_asset_ids)
        hot = [(aid, score) for aid, score in ranked if score > 0]

        if not hot:
            self._enter_ambient_mode()
            return

        # Handle pinned market
        target_asset = None
        target_market = None

        if self.pinned_slug:
            pinned = next(
                (m for m in self.all_markets if m["slug"] == self.pinned_slug),
                None
            )
            if pinned and pinned["asset_ids"]:
                target_asset = pinned["asset_ids"][0]
                target_market = pinned

        # Otherwise pick the hottest
        if not target_asset:
            target_asset = hot[0][0]
            target_market = self._find_market(target_asset)

        # Is it the same market we're already playing?
        if self.current_asset == target_asset:
            # Same market — just push updated params to all layers
            self._push_all_layers()
            return

        # Different market — should we switch?
        if self.current_asset:
            current_heat = self.scorer.heat(self.current_asset)
            target_heat = self.scorer.heat(target_asset)
            # Only switch if the new market is significantly hotter
            if target_heat - current_heat < SWAP_THRESHOLD:
                self._push_all_layers()
                return

        # Switch to the new market
        await self._switch_market(target_asset, target_market)

    async def _switch_market(self, asset_id: str, market: dict | None):
        """Transition the entire song to a new market."""
        question = market["question"] if market else asset_id[:16]

        if self.current_market:
            old_q = self.current_market["question"][:40]
            print(f"\n[DJ] === SWITCHING MARKET ===")
            print(f"[DJ]   From: {old_q}")
            print(f"[DJ]   To:   {question[:40]}")
        else:
            print(f"\n[DJ] === STARTING MARKET ===")
            print(f"[DJ]   {question[:60]}")

        self.current_market = market
        self.current_asset = asset_id

        # Assign all layers to this one market
        for slot in LAYER_INSTRUMENTS:
            was_playing = slot in self.layers
            self.layers[slot] = {
                "asset_id": asset_id,
                "question": question,
                "amp": 1.0,
            }
            if was_playing:
                self.osc.send_layer_command(slot, asset_id, "crossfade")
            else:
                self.osc.send_layer_command(slot, asset_id, "fade_in")

    def _push_all_layers(self):
        """Push current market params to every layer."""
        if not self.current_asset:
            return
        for slot in LAYER_INSTRUMENTS:
            self.osc.push_market_params(slot, self.current_asset)

    def _enter_ambient_mode(self):
        print("[DJ] Ambient mode -- no hot markets")
        self.current_market = None
        self.current_asset = None
        self.layers.clear()
        self.osc.send_global("ambient_mode", 1)

    def _find_market(self, asset_id: str) -> dict | None:
        for m in self.all_markets:
            if asset_id in m["asset_ids"]:
                return m
        return None

    def _log_now_playing(self):
        if not self.current_market:
            print("\n-- Now Playing: [ambient] --\n")
            return

        heat = self.scorer.heat(self.current_asset) if self.current_asset else 0
        vel = self.scorer.price_velocity(self.current_asset) if self.current_asset else 0
        rate = self.scorer.trade_rate(self.current_asset) if self.current_asset else 0
        bid, ask = self.scorer.spreads.get(self.current_asset, (0.4, 0.6))
        prices = list(self.scorer.price_history.get(self.current_asset, []))
        last_price = prices[-1][1] if prices else 0.5

        print(f"\n-- Now Playing -----------------------------------------------")
        print(f"  Market:  {self.current_market['question'][:60]}")
        print(f"  Slug:    {self.current_market.get('slug', '?')}")
        print(f"  Heat:    {heat:.2f}   Price: {last_price:.3f}   Velocity: {vel:.3f}")
        print(f"  Trades:  {rate:.2f}/min   Spread: {ask - bid:.4f}")
        print(f"--------------------------------------------------------------\n")

    # ── Resolution handler ────────────────────────────────

    def on_market_resolved(self, msg: dict):
        """Called when a market resolves. Triggers musical moment."""
        winning = msg.get("winning_outcome", "?")
        question = msg.get("question", "A market")
        print(f"[RESOLVED] {question} -> {winning}")

        self.osc.send_global("market_resolved", 1 if winning == "Yes" else -1)

        # If the resolved market is our current one, clear it so we pick a new one
        resolved_ids = set(msg.get("assets_ids", []))
        if self.current_asset in resolved_ids:
            print("[DJ] Current market resolved — will pick new market next cycle")
            self.current_market = None
            self.current_asset = None
            self.layers.clear()
