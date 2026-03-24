import json
import time
from datetime import datetime, timedelta, timezone
import requests
from config import GAMMA_API, MARKET_FETCH_LIMIT


def _now_et() -> datetime:
    """Current time in US Eastern. Uses EDT (UTC-4) Mar-Nov, EST (UTC-5) Nov-Mar.
    Approximates DST: second Sunday of March to first Sunday of November."""
    utc = datetime.now(timezone.utc)
    year = utc.year
    # Second Sunday of March
    mar1 = datetime(year, 3, 1, tzinfo=timezone.utc)
    dst_start = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7, hours=7)
    # First Sunday of November
    nov1 = datetime(year, 11, 1, tzinfo=timezone.utc)
    dst_end = nov1 + timedelta(days=(6 - nov1.weekday()) % 7, hours=6)
    offset = timedelta(hours=-4) if dst_start <= utc < dst_end else timedelta(hours=-5)
    return utc + offset

# Auto-generated financial event patterns on Polymarket.
# Each tuple: (slug_prefix, interval_seconds, category_tag)
LIVE_FINANCE_PATTERNS = [
    ("btc-updown-5m",  300,  "Bitcoin"),
    ("btc-updown-15m", 900,  "Bitcoin"),
    ("eth-updown-5m",  300,  "Ethereum"),
    ("eth-updown-15m", 900,  "Ethereum"),
]

# Hourly patterns use date-based slugs in ET timezone
# e.g. bitcoin-up-or-down-march-25-2026-10am-et
LIVE_HOURLY_PATTERNS = [
    ("bitcoin-up-or-down", "Bitcoin"),
]


def _parse_clob_token_ids(raw) -> list[str]:
    """clobTokenIds comes as a JSON string like '[\"id1\", \"id2\"]', not a list."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []
    return []


def _parse_json_string(raw, default=None) -> list:
    """Parse a JSON-encoded string like '[\"0.5\",\"0.5\"]' into a list."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            pass
    return default if default is not None else []


def _normalize_market(m: dict) -> dict:
    """Normalize a raw Gamma API market into our internal format."""
    outcome_prices = _parse_json_string(m.get("outcomePrices"))
    outcomes = _parse_json_string(m.get("outcomes"))
    return {
        "id":        m["id"],
        "slug":      m.get("slug", ""),
        "question":  m.get("question", "Unknown market"),
        "volume":    float(m.get("volume24hr") or 0),
        "asset_ids": _parse_clob_token_ids(m.get("clobTokenIds", "[]")),
        "end_date":  m.get("endDate"),
        "active":    m.get("active", True),
        "closed":    m.get("closed", False),
        "event_slug": m.get("events", [{}])[0].get("slug", "") if m.get("events") else "",
        "tags":      [t.get("label", t.get("slug", "")) for t in m.get("tags", [])],
        "outcomes":       outcomes,        # e.g. ["Up", "Down"] or ["Yes", "No"]
        "outcome_prices": [float(p) for p in outcome_prices] if outcome_prices else [],
    }


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
        _normalize_market(m)
        for m in markets
        if m.get("clobTokenIds")   # must have tradeable tokens
    ]


def fetch_market_by_slug(slug: str) -> dict | None:
    """Fetch a specific market by slug — used for request/pin mode."""
    resp = requests.get(f"{GAMMA_API}/markets", params={"slug": slug}, timeout=10)
    markets = resp.json()
    if not markets:
        return None
    return _normalize_market(markets[0])


def fetch_markets_by_event_slug(event_slug: str) -> list[dict]:
    """Fetch all markets under an event by its slug. Active markets sorted first."""
    resp = requests.get(f"{GAMMA_API}/events", params={"slug": event_slug}, timeout=10)
    events = resp.json()
    if not events:
        return []
    # Events endpoint returns event objects containing nested markets
    event = events[0] if isinstance(events, list) else events
    raw_markets = event.get("markets", [])
    if not raw_markets:
        return []
    # Nested markets may lack the parent event slug — inject it
    parent_slug = event.get("slug", event_slug)
    markets = [
        _normalize_market(m) for m in raw_markets
        if m.get("clobTokenIds")
    ]
    for m in markets:
        if not m.get("event_slug"):
            m["event_slug"] = parent_slug
    # Sort: active non-closed first, then by volume descending
    markets.sort(key=lambda m: (not m.get("active", True), m.get("closed", False), -m.get("volume", 0)))
    return markets


def fetch_browse_markets(tag_id: int | None = None, limit: int = 10,
                         sort: str = "volume") -> list[dict]:
    """Fetch markets for the Browse UI, filtered by category tag."""
    params = {
        "active": "true",
        "closed": "false",
        "limit": limit,
    }
    if tag_id is not None:
        params["tag_id"] = tag_id
    if sort == "closing":
        params["order"] = "end_date"
        params["ascending"] = "true"
    else:
        params["order"] = "volume24hr"
        params["ascending"] = "false"

    resp = requests.get(f"{GAMMA_API}/markets", params=params, timeout=10)
    resp.raise_for_status()
    markets = resp.json()

    return [
        _normalize_market(m)
        for m in markets
        if m.get("clobTokenIds")
    ]


def _hourly_slug(prefix: str, dt: datetime) -> str:
    """Build an hourly event slug like bitcoin-up-or-down-march-25-2026-10am-et."""
    month = dt.strftime("%B").lower()
    day = dt.day
    year = dt.year
    hour = int(dt.strftime("%I"))  # 12-hour, no leading zero
    ampm = dt.strftime("%p").lower()
    return f"{prefix}-{month}-{day}-{year}-{hour}{ampm}-et"


def fetch_live_finance_markets() -> list[dict]:
    """
    Fetch auto-generated financial markets (BTC/ETH 5/15-min and hourly up/down).
    These events rotate on fixed intervals with timestamp-based or date-based slugs.
    Tries the current and next window to catch active ones.
    Injects a category tag (e.g. "Bitcoin") so they group in the UI.
    """
    now = int(time.time())
    markets = []

    # Timestamp-based patterns (5m, 15m)
    for prefix, interval, tag in LIVE_FINANCE_PATTERNS:
        current_boundary = now - (now % interval)
        candidates = [current_boundary, current_boundary + interval]

        for ts in candidates:
            slug = f"{prefix}-{ts}"
            try:
                event_markets = fetch_markets_by_event_slug(slug)
                if event_markets:
                    for m in event_markets:
                        if tag not in m["tags"]:
                            m["tags"].append(tag)
                    markets.extend(event_markets)
                    break
            except Exception:
                continue

    # Hourly date-based patterns
    now_et = _now_et()
    for prefix, tag in LIVE_HOURLY_PATTERNS:
        candidates = [
            now_et.replace(minute=0, second=0, microsecond=0),
            now_et.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1),
        ]
        for dt in candidates:
            slug = _hourly_slug(prefix, dt)
            try:
                event_markets = fetch_markets_by_event_slug(slug)
                if event_markets:
                    for m in event_markets:
                        if tag not in m["tags"]:
                            m["tags"].append(tag)
                    markets.extend(event_markets)
                    break
            except Exception:
                continue

    return markets
