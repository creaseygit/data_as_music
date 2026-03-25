"""Extract unique instruments from tracks and generate simple test snippets."""

from __future__ import annotations

import re
from dataclasses import dataclass
from mastering.parser import parse_track, TrackParts


@dataclass
class Instrument:
    """A unique synth or sample used in a track."""
    name: str           # e.g. "piano", "sample:bd_haus"
    is_sample: bool
    test_code: str      # Sonic Pi code to play it once at reference level

    @property
    def safe_name(self) -> str:
        """Filename-safe version of the instrument name."""
        return self.name.replace(":", "_")


# Reference settings for test recordings
_REF_AMP = 0.3
_REF_NOTE = 60  # middle C — neutral pitch for synths
_REF_RELEASE = 1.5  # long enough to capture the full sound


def _make_test_code(name: str, is_sample: bool, set_volume: str | None, use_bpm: str | None) -> str:
    """Generate a simple .rb snippet that plays an instrument once."""
    parts = []
    parts.append(set_volume or "set_volume! 0.7")
    if use_bpm:
        parts.append(use_bpm)
    parts.append("")

    if is_sample:
        sample_name = name.replace("sample:", "")
        parts.append(f"sample :{sample_name}, amp: {_REF_AMP}")
    else:
        parts.append(f"use_synth :{name}")
        parts.append(f"play {_REF_NOTE}, amp: {_REF_AMP}, release: {_REF_RELEASE}")

    parts.append(f"sleep {_REF_RELEASE + 1}")
    return "\n".join(parts)


def extract_instruments(track_path: str) -> tuple[TrackParts, dict[str, list[str]], list[Instrument]]:
    """Extract all unique instruments from a track.

    Returns:
        (track_parts, loop_instruments, unique_instruments)
        - loop_instruments: {loop_name: [instrument_names]}
        - unique_instruments: deduplicated list of Instrument with test code
    """
    parts = parse_track(track_path)

    loop_instruments: dict[str, list[str]] = {}
    seen: dict[str, Instrument] = {}

    for loop_name, info in parts.loops.items():
        code = info.code
        # Find synths: use_synth :name or synth :name
        synths = re.findall(r'use_synth\s+:(\w+)', code)
        synths += re.findall(r'(?<!use_)synth\s+:(\w+)', code)
        # Find samples
        samples = [f"sample:{s}" for s in re.findall(r'sample\s+:(\w+)', code)]

        instruments = sorted(set(synths + samples))
        loop_instruments[loop_name] = instruments

        for inst_name in instruments:
            if inst_name not in seen:
                is_sample = inst_name.startswith("sample:")
                test_code = _make_test_code(
                    inst_name, is_sample, parts.set_volume, parts.use_bpm
                )
                seen[inst_name] = Instrument(
                    name=inst_name, is_sample=is_sample, test_code=test_code
                )

    return parts, loop_instruments, list(seen.values())
