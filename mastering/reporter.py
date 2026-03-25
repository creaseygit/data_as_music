"""Balance report — per-layer analysis table with amp correction suggestions."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict
from pathlib import Path

from mastering.analyzer import LayerAnalysis


@dataclass
class AmpCorrection:
    loop_name: str
    current_lufs: float
    target_lufs: float
    correction_db: float
    suggested_amp_multiplier: float
    advisory: bool  # True for event/ambient loops


@dataclass
class TrackReport:
    track_name: str
    layers: list[LayerAnalysis]
    corrections: list[AmpCorrection]
    loudest_layer: str
    quietest_layer: str
    dynamic_range_db: float


@dataclass
class Report:
    tracks: dict[str, TrackReport]
    target_lufs: float
    scenario: str


def _compute_corrections(
    layers: list[LayerAnalysis],
    target_lufs: float,
    max_dynamic_range: float = 12.0,
) -> list[AmpCorrection]:
    """Compute amp corrections to compress dynamic range while preserving hierarchy.

    Instead of normalizing every layer to the same LUFS (which flattens the mix),
    this compresses the dynamic range so no layer is more than max_dynamic_range dB
    below the loudest continuous layer. Quiet layers get boosted toward the loudest,
    but their relative ordering is preserved.

    Args:
        layers: Per-layer analysis results.
        target_lufs: Absolute target for the loudest layer (default -23 LUFS).
        max_dynamic_range: Maximum allowed gap between loudest and quietest (dB).
    """
    # Find the loudest non-event, non-silent layer as our anchor
    continuous = [l for l in layers if not l.is_silent and not l.is_event_loop]
    if not continuous:
        # All silent or event — no corrections
        return [
            AmpCorrection(l.loop_name, l.integrated_lufs, target_lufs, 0.0, 1.0, True)
            for l in layers
        ]

    anchor_lufs = max(l.integrated_lufs for l in continuous)
    # Shift to bring anchor to target_lufs
    anchor_shift = target_lufs - anchor_lufs

    corrections = []
    for layer in layers:
        if layer.is_silent:
            corrections.append(AmpCorrection(
                loop_name=layer.loop_name,
                current_lufs=layer.integrated_lufs,
                target_lufs=target_lufs,
                correction_db=0.0,
                suggested_amp_multiplier=1.0,
                advisory=True,
            ))
            continue

        if layer.is_event_loop:
            # Event loops: just apply the anchor shift (keep relative level)
            correction_db = anchor_shift
            corrections.append(AmpCorrection(
                loop_name=layer.loop_name,
                current_lufs=layer.integrated_lufs,
                target_lufs=round(layer.integrated_lufs + correction_db, 1),
                correction_db=round(correction_db, 1),
                suggested_amp_multiplier=round(10.0 ** (correction_db / 20.0), 2),
                advisory=True,
            ))
            continue

        # How far below the anchor is this layer?
        gap = anchor_lufs - layer.integrated_lufs  # positive = quieter

        if gap <= max_dynamic_range:
            # Within range — just apply the anchor shift
            correction_db = anchor_shift
        else:
            # Too quiet — compress: bring it up to max_dynamic_range below anchor
            # New LUFS = anchor_lufs - max_dynamic_range
            desired_lufs = anchor_lufs - max_dynamic_range
            correction_db = (desired_lufs - layer.integrated_lufs) + anchor_shift

        multiplier = 10.0 ** (correction_db / 20.0)

        corrections.append(AmpCorrection(
            loop_name=layer.loop_name,
            current_lufs=layer.integrated_lufs,
            target_lufs=round(layer.integrated_lufs + correction_db, 1),
            correction_db=round(correction_db, 1),
            suggested_amp_multiplier=round(multiplier, 2),
            advisory=False,
        ))

    return corrections


def generate_report(
    analyses: dict[str, list[LayerAnalysis]],
    target_lufs: float = -23.0,
    scenario: str = "default",
) -> Report:
    """Generate a balance report from per-track analysis results."""
    tracks: dict[str, TrackReport] = {}

    for track_name, layers in analyses.items():
        if not layers:
            continue

        corrections = _compute_corrections(layers, target_lufs)

        # Find loudest/quietest (excluding silent layers)
        active_layers = [l for l in layers if not l.is_silent]
        if active_layers:
            loudest = max(active_layers, key=lambda l: l.integrated_lufs)
            quietest = min(active_layers, key=lambda l: l.integrated_lufs)
            dynamic_range = loudest.integrated_lufs - quietest.integrated_lufs
        else:
            loudest = layers[0]
            quietest = layers[0]
            dynamic_range = 0.0

        tracks[track_name] = TrackReport(
            track_name=track_name,
            layers=layers,
            corrections=corrections,
            loudest_layer=f"{loudest.loop_name} ({loudest.integrated_lufs} LUFS)",
            quietest_layer=f"{quietest.loop_name} ({quietest.integrated_lufs} LUFS)",
            dynamic_range_db=round(dynamic_range, 1),
        )

    return Report(tracks=tracks, target_lufs=target_lufs, scenario=scenario)


def format_text_report(report: Report) -> str:
    """Format the report as a human-readable text table."""
    lines: list[str] = []
    lines.append("=" * 90)
    lines.append("MASTERING BALANCE REPORT")
    lines.append(f"Target LUFS: {report.target_lufs}  |  Scenario: {report.scenario}")
    lines.append("=" * 90)

    for track_name, track_report in report.tracks.items():
        lines.append("")
        lines.append(f"--- {track_name} ---")
        lines.append("")

        # Header
        header = (
            f"{'Layer':<20} {'LUFS':>7} {'RMS dB':>7} {'Peak dB':>8} "
            f"{'Centroid':>9} {'Correction':>11} {'Amp Mult':>9}"
        )
        lines.append(header)
        lines.append("-" * len(header))

        for layer, correction in zip(track_report.layers, track_report.corrections):
            if layer.is_silent:
                corr_str = "SILENT"
                mult_str = "-"
            elif correction.advisory:
                corr_str = "advisory"
                mult_str = "-"
            else:
                sign = "+" if correction.correction_db >= 0 else ""
                corr_str = f"{sign}{correction.correction_db} dB"
                mult_str = f"x{correction.suggested_amp_multiplier}"

            centroid_str = f"{layer.spectral_centroid_hz:.0f} Hz"

            line = (
                f"{layer.loop_name:<20} "
                f"{layer.integrated_lufs:>7.1f} "
                f"{layer.rms_db:>7.1f} "
                f"{layer.peak_db:>8.1f} "
                f"{centroid_str:>9} "
                f"{corr_str:>11} "
                f"{mult_str:>9}"
            )
            lines.append(line)

        lines.append("")
        lines.append(f"  Loudest:  {track_report.loudest_layer}")
        lines.append(f"  Quietest: {track_report.quietest_layer}")
        lines.append(f"  Dynamic range: {track_report.dynamic_range_db} dB")

    # Cross-track comparison for common layer types
    lines.append("")
    lines.append("=" * 90)
    lines.append("CROSS-TRACK COMPARISON (same-role layers)")
    lines.append("=" * 90)

    # Collect layers by role (name)
    role_map: dict[str, list[tuple[str, LayerAnalysis]]] = {}
    for track_name, track_report in report.tracks.items():
        for layer in track_report.layers:
            if layer.is_silent:
                continue
            role_map.setdefault(layer.loop_name, []).append((track_name, layer))

    # Only show roles that appear in multiple tracks
    for role_name, entries in sorted(role_map.items()):
        if len(entries) < 2:
            continue
        lines.append("")
        lines.append(f"  {role_name}:")
        for track_name, layer in entries:
            lines.append(
                f"    {track_name:<20} {layer.integrated_lufs:>7.1f} LUFS  "
                f"RMS {layer.rms_db:>6.1f} dB  "
                f"Centroid {layer.spectral_centroid_hz:.0f} Hz"
            )

    lines.append("")
    return "\n".join(lines)


def write_report(
    report: Report,
    output_dir: str,
    fmt: str = "both",
) -> None:
    """Write the report to disk as text and/or JSON."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    if fmt in ("txt", "both"):
        text = format_text_report(report)
        txt_path = out_path / "report.txt"
        txt_path.write_text(text, encoding="utf-8")
        print(f"\n[REPORT] Written to {txt_path}", flush=True)

    if fmt in ("json", "both"):
        # Serialize dataclasses to JSON
        data = {
            "target_lufs": report.target_lufs,
            "scenario": report.scenario,
            "tracks": {},
        }
        for track_name, track_report in report.tracks.items():
            data["tracks"][track_name] = {
                "loudest_layer": track_report.loudest_layer,
                "quietest_layer": track_report.quietest_layer,
                "dynamic_range_db": track_report.dynamic_range_db,
                "layers": [asdict(l) for l in track_report.layers],
                "corrections": [asdict(c) for c in track_report.corrections],
            }

        json_path = out_path / "report.json"
        json_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"[REPORT] Written to {json_path}", flush=True)
