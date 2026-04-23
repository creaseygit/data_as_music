"""CLOB price-history backfill.

Seeds the scorer's smoothed mid buffer from Polymarket's public
`clob.polymarket.com/prices-history` endpoint so window-based signals
(price_move, momentum, velocity, volatility) have data on the first
broadcast tick after a market is pinned — no multi-minute "tuning in"
period at lower sensitivities.

The endpoint is public and unauthenticated. Minimum granularity is
~1 minute regardless of `fidelity` or startTs/endTs; we linearly upsample
to the scorer's 3-second cadence before seeding. For freshly-opened
live-finance (5m/15m) markets the endpoint returns an empty history; in
that case the adaptive sensitivity window (server._compute_window_cap)
handles stabilization instead.
"""
import asyncio
import time

import requests

from config import CLOB_REST


def fetch_price_history(token_id: str, *, interval: str = "1h",
                        fidelity: int = 1, timeout: float = 2.0
                        ) -> list[tuple[float, float]]:
    """Fetch historical `{t, p}` points for a CLOB token.

    Returns list of (timestamp_seconds, price) sorted by time, or [] on
    failure or empty response. `interval='1h'` with `fidelity=1` gives
    the densest available data (~60 minute-spaced points covering the
    last hour). Short-lived markets may return [].
    """
    try:
        resp = requests.get(
            f"{CLOB_REST}/prices-history",
            params={"market": token_id, "interval": interval, "fidelity": fidelity},
            timeout=timeout,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        hist = data.get("history") or []
        points = []
        for p in hist:
            t = p.get("t")
            v = p.get("p")
            if t is None or v is None:
                continue
            points.append((float(t), float(v)))
        points.sort(key=lambda tp: tp[0])
        return points
    except (requests.RequestException, ValueError, KeyError) as e:
        print(f"[CLOB_HIST] {token_id[:12]}… fetch failed: {e}", flush=True)
        return []


def upsample_to_cadence(points: list[tuple[float, float]],
                        cadence_seconds: float,
                        max_samples: int
                        ) -> list[tuple[float, float]]:
    """Linearly interpolate sparse points onto a uniform `cadence_seconds`
    grid, anchored at the most recent point and extending backward.

    Returns at most `max_samples` points (oldest dropped first) so the
    result fits in the scorer's `price_history` deque. If the source has
    a single point, returns it unchanged (interpolation is ill-defined).
    """
    if len(points) < 2:
        return list(points)

    first_t = points[0][0]
    last_t = points[-1][0]
    if last_t <= first_t:
        return list(points)

    grid = []
    t = last_t
    while t >= first_t and len(grid) < max_samples:
        grid.append(t)
        t -= cadence_seconds
    grid.reverse()

    result = []
    j = 0
    for target in grid:
        while j + 1 < len(points) and points[j + 1][0] < target:
            j += 1
        if j + 1 >= len(points):
            result.append((target, points[-1][1]))
            continue
        t0, p0 = points[j]
        t1, p1 = points[j + 1]
        if t1 == t0:
            result.append((target, p1))
        else:
            frac = max(0.0, min(1.0, (target - t0) / (t1 - t0)))
            result.append((target, p0 + frac * (p1 - p0)))
    return result


async def backfill_scorer(scorer, token_id: str,
                          cadence_seconds: float = 3.0) -> int:
    """Seed `scorer.price_history[token_id]` from the CLOB history endpoint.

    Returns the number of samples seeded (0 on empty/failure). Best-effort:
    the caller should still tolerate the pre-backfill state since
    freshly-opened short-lived markets return no history.

    Even a single historical point is seeded: alert tracks like Weather
    Vane are change-based — one reference point plus the first live tick
    is enough to produce a directional signal.
    """
    points = await asyncio.to_thread(fetch_price_history, token_id)
    if not points:
        return 0

    hist = scorer.price_history[token_id]
    raw = scorer._raw_mid_samples[token_id]

    if len(points) == 1:
        t, p = points[0]
        hist.clear()
        hist.append((t, p))
        raw.clear()
        raw.append(p)
        return 1

    upsampled = upsample_to_cadence(points, cadence_seconds, scorer.MID_HISTORY_MAXLEN)
    hist.clear()
    hist.extend(upsampled)
    raw.clear()
    for _, p in upsampled[-scorer.MID_SMOOTH_WINDOW:]:
        raw.append(p)
    return len(upsampled)
