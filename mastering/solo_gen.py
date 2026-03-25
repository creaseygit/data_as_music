"""Generate standalone .rb snippets that isolate a single live_loop for recording."""

from __future__ import annotations

import re
from mastering.parser import TrackParts, LoopInfo


TEST_SCENARIOS: dict[str, dict[str, float | int]] = {
    "default": {
        "heat": 0.5, "price": 0.5, "velocity": 0.3,
        "trade_rate": 0.4, "spread": 0.2, "tone": 1,
        "event_spike": 0, "event_price_move": 0,
        "market_resolved": 0, "ambient_mode": 0,
    },
    "high_activity": {
        "heat": 0.9, "price": 0.7, "velocity": 0.6,
        "trade_rate": 0.8, "spread": 0.1, "tone": 1,
        "event_spike": 0, "event_price_move": 0,
        "market_resolved": 0, "ambient_mode": 0,
    },
    "low_activity": {
        "heat": 0.15, "price": 0.3, "velocity": 0.05,
        "trade_rate": 0.1, "spread": 0.4, "tone": 0,
        "event_spike": 0, "event_price_move": 0,
        "market_resolved": 0, "ambient_mode": 0,
    },
}

# Reference amp level — used in reference mode so every synth/sample
# plays at the same authored amp, revealing intrinsic loudness differences
REFERENCE_AMP = 0.3

# Regex patterns for normalizing amp values in reference mode
_AMP_VAR_RE = re.compile(r"^(\s*)(amp_val|vol|amp_env|v)\s*=\s*(.+)$", re.MULTILINE)

# Event trigger loop — fires all event types on a schedule
_EVENT_TRIGGER = """\
live_loop :_trigger do
  sleep 2
  set :event_spike, 1
  sleep 3
  set :event_price_move, 1
  sleep 3
  set :event_price_move, -1
  sleep 3
  set :market_resolved, 1
  sleep 3
  set :market_resolved, -1
  sleep 3
  stop
end"""

# Price oscillator for loops that trigger on price delta (oracle price_watch)
_PRICE_TRIGGER = """\
live_loop :_trigger do
  set :price, 0.3
  sleep 3
  set :price, 0.6
  sleep 3
  set :price, 0.35
  sleep 3
  set :price, 0.65
  sleep 3
  stop
end"""


def _replace_amp_param(code: str, ref_amp: float) -> str:
    """Replace amp: <expression> with amp: ref_amp, handling nested parens.

    Matches from 'amp:' to the next keyword param (e.g. ', release:') or
    end of significant content, correctly skipping commas inside parentheses
    like rrand(0.7, 1.0).
    """
    result = []
    i = 0
    amp_pattern = re.compile(r"amp:\s*")
    # Keyword params that follow amp in play/synth/sample calls
    next_param = re.compile(r",\s*\w+:")

    while i < len(code):
        m = amp_pattern.search(code, i)
        if not m:
            result.append(code[i:])
            break

        # Append everything before the match
        result.append(code[i:m.start()])
        result.append(f"amp: {ref_amp}")

        # Now skip past the original amp value expression
        j = m.end()
        depth = 0
        while j < len(code):
            ch = code[j]
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
            elif ch == "," and depth == 0:
                # Check if this comma is followed by a keyword param
                rest = code[j:]
                pm = next_param.match(rest)
                if pm:
                    break
                # Otherwise it's a top-level comma (e.g. end of arg in a call)
                break
            elif ch == "\n":
                break
            j += 1

        i = j  # continue from after the amp value

    return "".join(result)


def _normalize_amps(code: str, ref_amp: float = REFERENCE_AMP) -> str:
    """Replace all amp: values and amp variable assignments with a fixed reference.

    This makes every synth/sample play at the same level so the measured LUFS
    reflects the intrinsic loudness of the synth/sample + FX chain, not the
    authored amp expression.
    """
    # Replace amp: <expression> with amp: ref_amp (handles nested parens)
    code = _replace_amp_param(code, ref_amp)

    # Replace amp variable assignments: amp_val = ..., vol = ..., amp_env = ...
    code = _AMP_VAR_RE.sub(rf"\g<1>\g<2> = {ref_amp}", code)

    return code


def _needs_price_trigger(loop: LoopInfo) -> bool:
    """Check if the loop triggers on price delta rather than events."""
    return "prev_price" in loop.code and "delta" in loop.code


def _build_defaults(track: TrackParts, scenario: str) -> list[str]:
    """Build set :name, value lines with scenario overrides."""
    values = TEST_SCENARIOS[scenario]
    lines = []
    for default_line in track.defaults:
        # Parse the original: "set :heat, 0.4"
        m = re.match(r"set\s+:(\w+),\s*(.+)$", default_line)
        if m:
            name = m.group(1)
            if name in values:
                val = values[name]
                # Format: int for 0/1, float for others
                if isinstance(val, int) or (isinstance(val, float) and val == int(val)):
                    lines.append(f"set :{name}, {int(val)}")
                else:
                    lines.append(f"set :{name}, {val}")
            else:
                lines.append(default_line)
        else:
            lines.append(default_line)
    return lines


def _build_sync_stub(track: TrackParts, sync_target: str) -> str:
    """Build a silent timing stub for a sync dependency.

    Extracts the primary sleep duration from the target loop and creates
    a minimal loop that just fires the cue.
    """
    target_loop = track.loops.get(sync_target)
    if not target_loop:
        # Fallback: generic 1-beat stub
        return f"live_loop :{sync_target} do\n  sleep 1\nend"

    # Try to find the primary sleep in the target loop
    sleeps = re.findall(r"sleep\s+([\d.]+)", target_loop.code)
    if sleeps:
        # Use the first sleep value as the primary cycle
        sleep_val = sleeps[0]
    else:
        sleep_val = "1"

    return f"live_loop :{sync_target} do\n  sleep {sleep_val}\nend"


def generate_solo(
    track: TrackParts,
    loop_name: str,
    scenario: str = "default",
    reference: bool = False,
) -> str:
    """Generate a complete .rb snippet that isolates a single live_loop.

    Args:
        track: Parsed track parts.
        loop_name: Name of the live_loop to isolate.
        scenario: Test data scenario name.
        reference: If True, normalize all amp values to REFERENCE_AMP and use
                   high_activity data so every layer plays at a flat known volume.
                   This reveals intrinsic synth/sample loudness for calibration.
    """
    # Reference mode forces high_activity to open all conditional gates
    if reference:
        scenario = "high_activity"

    if scenario not in TEST_SCENARIOS:
        raise ValueError(f"Unknown scenario: {scenario}. Choose from: {list(TEST_SCENARIOS.keys())}")

    loop = track.loops.get(loop_name)
    if not loop:
        raise ValueError(f"Loop '{loop_name}' not found in track '{track.track_name}'. "
                         f"Available: {list(track.loops.keys())}")

    parts: list[str] = []

    # 1. set_volume!
    if track.set_volume:
        parts.append(track.set_volume)

    # 2. use_bpm
    if track.use_bpm:
        parts.append(track.use_bpm)

    # 3. Defaults with scenario overrides
    defaults = _build_defaults(track, scenario)

    # Override ambient_mode for ambient loops
    if loop.is_ambient_loop:
        defaults = [
            "set :ambient_mode, 1" if "ambient_mode" in d else d
            for d in defaults
        ]

    parts.extend(defaults)

    # 4. Top-level variables
    for var_line in track.top_level_vars:
        m = re.match(r"(\w+)\s*=", var_line)
        if m and m.group(1) in loop.uses_top_vars:
            parts.append(var_line)

    parts.append("")  # blank separator

    # 5. Define blocks (resolve transitive dependencies)
    needed_defines = set(loop.uses_defines)
    # Check if any define references another define
    for dname in list(needed_defines):
        if dname in track.defines:
            for other_name, other_code in track.defines.items():
                if other_name != dname and other_name in needed_defines:
                    continue
                if re.search(rf"\b{re.escape(other_name)}\b", track.defines[dname]):
                    needed_defines.add(other_name)

    # Emit defines in their original order
    for dname in track.defines:
        if dname in needed_defines:
            parts.append(track.defines[dname])
            parts.append("")

    # 6. Sync stub
    if loop.sync_target:
        parts.append(_build_sync_stub(track, loop.sync_target))
        parts.append("")

    # 7. Event/price trigger loop
    if loop.is_event_loop:
        if _needs_price_trigger(loop):
            parts.append(_PRICE_TRIGGER)
        else:
            parts.append(_EVENT_TRIGGER)
        parts.append("")
    elif _needs_price_trigger(loop):
        parts.append(_PRICE_TRIGGER)
        parts.append("")

    # 8. The target live_loop
    parts.append(loop.code)

    result = "\n".join(parts)

    # 9. Reference mode: normalize all amp values to a flat reference level
    if reference:
        result = _normalize_amps(result)

    return result


def generate_all_solos(
    track: TrackParts,
    scenario: str = "default",
    reference: bool = False,
) -> dict[str, str]:
    """Generate solo snippets for all loops in a track.

    Returns {loop_name: rb_code_string}.
    """
    return {
        name: generate_solo(track, name, scenario, reference=reference)
        for name in track.loops
    }
