import asyncio
from config import RESCORE_INTERVAL, SWAP_THRESHOLD


class AutonomousDJ:
    """
    Single-market DJ. Two modes:

    Manual (default): A market is selected via pin_market() and plays
    until another is selected. No automatic switching.

    Autonomous: The hottest market plays automatically. Switches
    when a significantly hotter market emerges.
    """

    def __init__(self, scorer, feed, osc_bridge, gamma):
        self.scorer     = scorer
        self.feed       = feed
        self.osc        = osc_bridge
        self.gamma      = gamma

        self.current_market = None
        self.current_asset  = None
        self.all_markets = []

        # Mode: False = manual (default), True = autonomous
        self.autonomous = False
        self.pinned_slug = None

    # ── Public control ────────────────────────────────────

    def pin_market(self, slug: str):
        """Select a specific market to play. Stays until changed."""
        self.pinned_slug = slug
        self.autonomous = False
        # Find and switch immediately
        market = next(
            (m for m in self.all_markets if m["slug"] == slug), None
        )
        if market and market["asset_ids"]:
            aid = self._primary_asset(market)
            self._switch_market(aid, market)
        print(f"[DJ] Playing: {slug}", flush=True)

    def unpin(self):
        """Clear pinned market. If autonomous, DJ picks next. If manual, keeps current."""
        self.pinned_slug = None

    def set_autonomous(self, enabled: bool):
        """Toggle autonomous mode."""
        self.autonomous = enabled
        if enabled:
            self.pinned_slug = None
            print("[DJ] Autonomous mode ON", flush=True)
        else:
            print("[DJ] Manual mode ON", flush=True)

    # ── Main loop ─────────────────────────────────────────

    async def run(self):
        await self._refresh_markets()

        while True:
            await asyncio.sleep(RESCORE_INTERVAL)
            await self._refresh_markets()
            if self.autonomous:
                await self._auto_mix()
            self._log_now_playing()

    async def _refresh_markets(self):
        """Pull fresh market list from Gamma, update scorer volumes."""
        try:
            markets = self.gamma.fetch_active_markets()
            self.all_markets = markets

            for m in markets:
                for asset_id in m["asset_ids"]:
                    self.scorer.set_volume(asset_id, m["volume"])
                # Seed API prices for all markets
                self._seed_prices(m)

            # Keep current_market's API prices up to date
            if self.current_market:
                fresh = next((m for m in markets if m["slug"] == self.current_market["slug"]), None)
                if fresh:
                    self.current_market["outcome_prices"] = fresh.get("outcome_prices", [])
                    self.current_market["outcomes"] = fresh.get("outcomes", [])

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

    async def _auto_mix(self):
        """Autonomous mode: pick the hottest market."""
        if not self.all_markets:
            return

        # Rank by primary asset per market (the Yes/Up outcome)
        primary_aids = [self._primary_asset(m) for m in self.all_markets if m["asset_ids"]]
        ranked = self.scorer.rank(primary_aids)
        hot = [(aid, score) for aid, score in ranked if score > 0]

        if not hot:
            self._enter_ambient_mode()
            return

        target_asset = hot[0][0]
        target_market = self._find_market(target_asset)

        if self.current_asset == target_asset:
            return

        if self.current_asset:
            current_heat = self.scorer.heat(self.current_asset)
            target_heat = self.scorer.heat(target_asset)
            if target_heat - current_heat < SWAP_THRESHOLD:
                return

        self._switch_market(target_asset, target_market)

    def _switch_market(self, asset_id: str, market: dict | None):
        """Switch to a new market."""
        question = market["question"] if market else asset_id[:16]

        if self.current_market:
            old_q = self.current_market["question"][:40]
            print(f"[DJ] === SWITCHING: {old_q} -> {question[:40]}", flush=True)
        else:
            print(f"[DJ] === NOW PLAYING: {question[:60]}", flush=True)

        self.current_market = market
        self.current_asset = asset_id

        # Seed scorer with API prices so display is correct immediately
        if market:
            self._seed_prices(market)

    @staticmethod
    def _primary_asset(market: dict) -> str:
        """Pick the asset_id for the primary outcome (Yes/Up), matching Polymarket's display."""
        outcomes = market.get("outcomes", [])
        asset_ids = market.get("asset_ids", [])
        if outcomes and asset_ids and len(outcomes) == len(asset_ids):
            # Prefer the positive outcome
            for i, name in enumerate(outcomes):
                if name.lower() in ("yes", "up"):
                    return asset_ids[i]
        # Fallback to first
        return asset_ids[0] if asset_ids else ""

    def _seed_prices(self, market: dict):
        """Seed the scorer with API prices so values are correct before websocket data arrives."""
        asset_ids = market.get("asset_ids", [])
        outcome_prices = market.get("outcome_prices", [])
        if not asset_ids or not outcome_prices:
            return
        for i, aid in enumerate(asset_ids):
            if i < len(outcome_prices):
                price = outcome_prices[i]
                # Only seed if no recent websocket data exists
                existing = list(self.scorer.price_history.get(aid, []))
                if not existing:
                    self.scorer.on_price_change(aid, price)
                    print(f"[DJ] Seeded price {aid[:8]}... = {price:.4f}", flush=True)

    def _enter_ambient_mode(self):
        print("[DJ] Ambient mode -- no hot markets", flush=True)
        self.current_market = None
        self.current_asset = None
        self.osc.send_global("ambient_mode", 1)

    def _find_market(self, asset_id: str) -> dict | None:
        for m in self.all_markets:
            if asset_id in m["asset_ids"]:
                return m
        return None

    def _log_now_playing(self):
        if not self.current_market:
            return
        heat = self.scorer.heat(self.current_asset) if self.current_asset else 0
        mode = "AUTO" if self.autonomous else "MANUAL"
        print(f"[DJ] [{mode}] heat={heat:.2f}  {self.current_market['question'][:50]}", flush=True)

    def on_market_resolved(self, msg: dict):
        winning = msg.get("winning_outcome", "?")
        question = msg.get("question", "A market")
        print(f"[RESOLVED] {question} -> {winning}", flush=True)

        self.osc.send_global("market_resolved", 1 if winning == "Yes" else -1)

        resolved_ids = set(msg.get("assets_ids", []))
        if self.current_asset in resolved_ids:
            print("[DJ] Current market resolved", flush=True)
            self.current_market = None
            self.current_asset = None
            self.pinned_slug = None
