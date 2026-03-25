"""Apply mastering corrections to track .rb files.

Wraps each corrected live_loop body in `with_fx :level, amp: X do ... end`.
The :level effect is a transparent gain stage with near-zero CPU cost.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from mastering.parser import parse_track


_MARKER = "# [mastering]"


def apply_corrections(
    track_path: str,
    report_path: str,
    output_path: str | None = None,
    threshold_db: float = 1.5,
) -> str | None:
    """Apply mastering corrections to a track .rb file.

    Reads loop_corrections from the report and wraps each corrected loop
    in a `with_fx :level` gain stage.
    """
    track_file = Path(track_path)
    track_name = track_file.stem

    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    corrections = report.get("loop_corrections", {})

    if not corrections:
        print(f"  [APPLY] No corrections for '{track_name}'")
        return None

    # Read the track
    code = track_file.read_text(encoding="utf-8")

    # Parse to find loop boundaries
    parts = parse_track(track_path)

    applied = 0
    for loop_name, corr in corrections.items():
        mult = corr["suggested_amp_multiplier"]
        correction_db = corr["correction_db"]

        if abs(correction_db) < threshold_db:
            continue

        if loop_name not in parts.loops:
            continue

        loop_info = parts.loops[loop_name]
        original_loop = loop_info.code

        if original_loop not in code:
            print(f"  [APPLY] WARNING: can't find loop '{loop_name}', skipping")
            continue

        # Split loop into header, body, closing end
        loop_lines = original_loop.splitlines()
        header = loop_lines[0]
        body_lines = loop_lines[1:-1]

        # Indent body by 2 more spaces and wrap in with_fx :level
        indented_body = "\n".join("  " + l if l.strip() else l for l in body_lines)
        new_loop = (
            f"{header}\n"
            f"  with_fx :level, amp: {mult} do {_MARKER}\n"
            f"{indented_body}\n"
            f"  end\n"
            f"end"
        )

        code = code.replace(original_loop, new_loop)
        direction = "boost" if mult > 1 else "cut"
        print(f"  [APPLY] {loop_name}: x{mult} ({correction_db:+.1f} dB {direction})")
        applied += 1

    if applied == 0:
        print(f"  [APPLY] No corrections applied for '{track_name}'")
        return None

    # Write output
    if output_path:
        out = Path(output_path)
    else:
        backup = track_file.with_suffix(".rb.bak")
        if not backup.exists():
            shutil.copy2(track_file, backup)
            print(f"  [APPLY] Backup: {backup}")
        out = track_file

    out.write_text(code, encoding="utf-8")
    print(f"  [APPLY] Written: {out} ({applied} loops corrected)")
    return str(out)


def revert_track(track_path: str) -> bool:
    """Revert a track to its pre-mastering backup."""
    track_file = Path(track_path)
    backup = track_file.with_suffix(".rb.bak")
    if backup.exists():
        shutil.copy2(backup, track_file)
        print(f"[REVERT] Restored {track_file} from {backup}")
        return True
    else:
        print(f"[REVERT] No backup found for {track_file}")
        return False
