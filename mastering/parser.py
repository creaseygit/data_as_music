"""Parse Sonic Pi .rb track files into structured parts for solo generation."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LoopInfo:
    name: str
    code: str
    sync_target: str | None = None
    uses_defines: list[str] = field(default_factory=list)
    uses_top_vars: list[str] = field(default_factory=list)
    is_event_loop: bool = False
    is_ambient_loop: bool = False


@dataclass
class TrackParts:
    track_name: str
    set_volume: str | None = None
    use_bpm: str | None = None
    defaults: list[str] = field(default_factory=list)
    top_level_vars: list[str] = field(default_factory=list)
    defines: dict[str, str] = field(default_factory=dict)
    loops: dict[str, LoopInfo] = field(default_factory=dict)


_SET_DEFAULT_RE = re.compile(r"^set\s+:\w+,\s*.+$")
_SET_VOLUME_RE = re.compile(r"^set_volume!\s*.+$")
_USE_BPM_RE = re.compile(r"^use_bpm\s+\d+")
_TOP_VAR_RE = re.compile(r"^(\w+)\s*=\s*.+$")
_DEFINE_RE = re.compile(r"^define\s+:(\w+)\s+do")
_LIVE_LOOP_RE = re.compile(r"^live_loop\s+:(\w+)(?:,\s*sync:\s*:(\w+))?\s+do")

# Ruby block openers that increment nesting depth
_BLOCK_OPEN_RE = re.compile(
    r"\b(do|if|unless|case|begin|while|until|for)\b"
)
# Inline if/unless (e.g. `play n if cond`) don't open blocks
_INLINE_COND_RE = re.compile(r".+\b(if|unless)\b.+$")

EVENT_GETTERS = {"event_spike", "event_price_move", "market_resolved"}
AMBIENT_GETTER = "ambient_mode"


def _extract_blocks(lines: list[str], start_re: re.Pattern) -> list[tuple[str, int, int]]:
    """Find top-level blocks matching start_re.

    Returns list of (name, start_line_idx, end_line_idx) inclusive.
    Uses column-0 `end` matching: blocks start at column 0 and their
    closing `end` is also at column 0 (no leading whitespace).
    """
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = start_re.match(line.strip())
        # Only match lines that start at column 0 (no indentation)
        if m and (len(line) == len(line.lstrip())):
            name = m.group(1)
            start = i
            # Find the matching column-0 `end`
            depth = 1
            j = i + 1
            while j < len(lines):
                stripped = lines[j].strip()
                # Column-0 end
                if lines[j].rstrip() == "end" or re.match(r"^end\b", lines[j]):
                    depth -= 1
                    if depth == 0:
                        blocks.append((name, start, j))
                        break
                # Nested block openers at non-zero indent
                elif re.match(r"^\s+(live_loop|define)\b", lines[j]):
                    depth += 1
                j += 1
            i = j + 1 if depth == 0 else j + 1
        else:
            i += 1
    return blocks


def _classify_loop(code: str) -> tuple[bool, bool]:
    """Return (is_event_loop, is_ambient_loop) by scanning for get() calls."""
    is_event = any(f"get(:{g})" in code for g in EVENT_GETTERS)
    is_ambient = f"get(:{AMBIENT_GETTER})" in code
    return is_event, is_ambient


def _find_define_refs(code: str, define_names: list[str]) -> list[str]:
    """Find which define names are called in the given code."""
    refs = []
    for name in define_names:
        # Match function call: name followed by optional args
        if re.search(rf"\b{re.escape(name)}\b", code):
            refs.append(name)
    return refs


def _find_var_refs(code: str, var_names: list[str]) -> list[str]:
    """Find which top-level variables are referenced in the given code."""
    refs = []
    for var in var_names:
        if re.search(rf"\b{re.escape(var)}\b", code):
            refs.append(var)
    return refs


def parse_track(filepath: str) -> TrackParts:
    """Parse a Sonic Pi .rb track file into structured parts."""
    path = Path(filepath)
    track_name = path.stem
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    parts = TrackParts(track_name=track_name)

    # First pass: find where defines and live_loops start
    first_block_line = len(lines)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if _DEFINE_RE.match(stripped) or _LIVE_LOOP_RE.match(stripped):
            if len(line) == len(line.lstrip()):  # column 0
                first_block_line = i
                break

    # Extract preamble (everything before first block)
    for i in range(first_block_line):
        stripped = lines[i].strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _SET_VOLUME_RE.match(stripped):
            parts.set_volume = stripped
        elif _USE_BPM_RE.match(stripped):
            parts.use_bpm = stripped
        elif _SET_DEFAULT_RE.match(stripped):
            parts.defaults.append(stripped)
        elif _TOP_VAR_RE.match(stripped):
            # Exclude Ruby keywords and known non-variables
            varname = _TOP_VAR_RE.match(stripped).group(1)
            if varname not in ("set", "use_bpm", "set_volume"):
                parts.top_level_vars.append(stripped)

    # Extract define blocks
    define_blocks = _extract_blocks(lines, _DEFINE_RE)
    for name, start, end in define_blocks:
        parts.defines[name] = "\n".join(lines[start : end + 1])

    # Extract live_loop blocks
    loop_blocks = _extract_blocks(lines, _LIVE_LOOP_RE)
    define_names = list(parts.defines.keys())
    var_names = [_TOP_VAR_RE.match(v).group(1) for v in parts.top_level_vars]

    for block_name, start, end in loop_blocks:
        code = "\n".join(lines[start : end + 1])
        # Extract sync target from the live_loop line
        loop_line = lines[start].strip()
        m = _LIVE_LOOP_RE.match(loop_line)
        sync_target = m.group(2) if m and m.group(2) else None

        is_event, is_ambient = _classify_loop(code)
        uses_defines = _find_define_refs(code, define_names)
        uses_top_vars = _find_var_refs(code, var_names)

        parts.loops[block_name] = LoopInfo(
            name=block_name,
            code=code,
            sync_target=sync_target,
            uses_defines=uses_defines,
            uses_top_vars=uses_top_vars,
            is_event_loop=is_event,
            is_ambient_loop=is_ambient,
        )

    return parts
