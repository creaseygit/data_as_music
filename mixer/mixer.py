import asyncio
import re
from datetime import datetime, timezone
from config import RESCORE_INTERVAL

# Matches live finance event slugs like btc-updown-15m-1774385100
_LIVE_SLUG_RE = re.compile(r"^(btc|eth)-updown-\d+m-\d+$|^bitcoin-up-or-down-.+-et$")


class AutonomousDJ:
    """
    Single-market DJ. A market is selected via pin_market() and plays
    until another is selected.
    """

    def __init__(self, scorer, feed, gamma, on_event=None):
        self.scorer     = scorer
        self.feed       = feed
        self.gamma      = gamma
        self.on_event   = on_event    # async callback: on_event(event_type, data)

        self.current_market = None
        self.current_asset  = None
        self.all_markets = []
        self.pinned_slug = None
        self.on_market_ended = None   # async callback when non-live market resolves

    # ── Public control ────────────────────────────────────

    def pin_market(self, slug: str):
        """Select a specific market to play. Stays until changed."""
        self.pinned_slug = slug
        # Find and switch immediately
        market = next(
            (m for m in self.all_markets if m["slug"] == slug), None
        )
        if market and market["asset_ids"]:
            aid = self._primary_asset(market)
            self._switch_market(aid, market)
        print(f"[DJ] Playing: {slug}", flush=True)

    # ── Main loop ─────────────────────────────────────────

    async def run(self):
        await self._refresh_markets()

        while True:
            await asyncio.sleep(RESCORE_INTERVAL)
            await self._refresh_markets()
            await self._check_live_rotation()
            self._log_now_playing()

    async def _refresh_markets(self):
        """Pull fresh market list from Gamma, update scorer volumes."""
        try:
            markets = self.gamma.fetch_active_markets()
            self.all_markets = markets

            for m in markets:
                for asset_id in m["asset_ids"]:
                    self.scorer.set_volume(asset_id, m["volume"])

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

    @staticmethod
    def _primary_asset(market: dict) -> str:
        """Pick the asset_id for the primary outcome (Yes/Up)."""
        outcomes = market.get("outcomes", [])
        asset_ids = market.get("asset_ids", [])
        if outcomes and asset_ids and len(outcomes) == len(asset_ids):
            # Prefer the positive outcome
            for i, name in enumerate(outcomes):
                if name.lower() in ("yes", "up"):
                    return asset_ids[i]
        # Fallback to first
        return asset_ids[0] if asset_ids else ""

    def _log_now_playing(self):
        if not self.current_market:
            return
        heat = self.scorer.heat(self.current_asset) if self.current_asset else 0
        live_tag = " [LIVE]" if self._is_live_finance(self.current_market) else ""
        print(f"[DJ]{live_tag} heat={heat:.2f}  {self.current_market['question'][:50]}", flush=True)

    @staticmethod
    def _is_live_finance(market: dict) -> bool:
        """Check if a market belongs to a rotating live finance event."""
        slug = market.get("event_slug", "")
        return bool(_LIVE_SLUG_RE.match(slug))

    async def _check_live_rotation(self):
        """If current market is a live finance market that has ended, rotate to next window."""
        if not self.current_market:
            return
        event_slug = self.current_market.get("event_slug", "")
        is_live = self._is_live_finance(self.current_market)
        if not is_live:
            return
        end_str = self.current_market.get("end_date")
        if not end_str:
            print(f"[LIVE] Market is live finance ({event_slug}) but has no end_date", flush=True)
            return
        try:
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            now_utc = datetime.now(timezone.utc)
            remaining = (end_dt - now_utc).total_seconds()
            if remaining > 0:
                mins = int(remaining // 60)
                secs = int(remaining % 60)
                print(f"[LIVE] {event_slug} ends in {mins}m{secs}s ({end_str})", flush=True)
                return
        except (ValueError, TypeError) as e:
            print(f"[LIVE] Failed to parse end_date '{end_str}': {e}", flush=True)
            return

        print(f"[LIVE] Market ended! Rotating from {event_slug}...", flush=True)
        await self._rotate_live_market()

    async def _rotate_live_market(self):
        """Fetch next live finance markets and switch to matching pattern."""
        try:
            from market.gamma import fetch_live_finance_markets
            print("[LIVE] Fetching live finance markets...", flush=True)
            live = fetch_live_finance_markets()
            print(f"[LIVE] Found {len(live)} live markets: {[m.get('event_slug','?') for m in live]}", flush=True)
            if not live:
                print("[LIVE] No next live market found yet, will retry next cycle", flush=True)
                return

            # Try to find the same pattern (e.g. btc-updown-15m)
            old_slug = self.current_market.get("event_slug", "") if self.current_market else ""
            # Extract prefix like "btc-updown-15m" or "bitcoin-up-or-down"
            prefix = re.sub(r"-\d+$", "", old_slug)  # strip trailing timestamp
            prefix = re.sub(r"-[a-z]+-\d+-\d+-\d+[ap]m-et$", "", prefix)  # strip date suffix
            print(f"[LIVE] Looking for prefix '{prefix}' (was '{old_slug}')", flush=True)

            match = None
            for m in live:
                es = m.get("event_slug", "")
                if es.startswith(prefix) and m["asset_ids"] and es != old_slug:
                    match = m
                    break
            # Fallback to any live market with different slug
            if not match:
                match = next((m for m in live if m["asset_ids"] and m.get("event_slug", "") != old_slug), None)
            # Last resort: same slug (market might still be the only one)
            if not match:
                match = next((m for m in live if m["asset_ids"]), None)
            if not match:
                print("[LIVE] No tradeable live market found", flush=True)
                return
            print(f"[LIVE] Matched: {match.get('event_slug', '?')} — {match['question'][:50]}", flush=True)

            # Inject into all_markets and pin
            existing = next((m for m in self.all_markets if m["slug"] == match["slug"]), None)
            if not existing:
                self.all_markets.append(match)
            aid = self._primary_asset(match)
            self._switch_market(aid, match)
            self.pinned_slug = match["slug"]

            # Subscribe to new asset
            if aid not in self.feed.subscribed:
                await self.feed.update_subscriptions(add=[aid], remove=[])

            print(f"[DJ] Auto-rotated to: {match['question'][:60]}", flush=True)
        except Exception as e:
            print(f"[DJ] Live rotation failed: {e}", flush=True)

    def on_market_resolved(self, msg: dict):
        winning = msg.get("winning_outcome", "?")
        question = msg.get("question", "A market")
        print(f"[RESOLVED] {question} -> {winning}", flush=True)

        result = 1 if winning == "Yes" else -1
        if self.on_event:
            asyncio.ensure_future(self.on_event("resolved", {"result": result}))

        resolved_ids = set(msg.get("assets_ids", []))
        if self.current_asset in resolved_ids:
            was_live = self._is_live_finance(self.current_market) if self.current_market else False
            print("[DJ] Current market resolved", flush=True)
            self.current_market = None
            self.current_asset = None
            self.pinned_slug = None
            # If it was a live finance market, schedule immediate rotation
            if was_live:
                asyncio.ensure_future(self._rotate_live_market())
            elif self.on_market_ended:
                asyncio.ensure_future(self.on_market_ended())
