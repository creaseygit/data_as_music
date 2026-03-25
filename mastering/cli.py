"""CLI entry point for the mastering pipeline.

Simple approach:
1. Find all unique synths/samples in a track
2. Record each one playing a single note at a reference amp
3. Measure LUFS — this is the instrument's intrinsic loudness
4. Apply per-loop corrections so all instruments sit at the same level
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from mastering.instruments import extract_instruments
from mastering.recorder import MasteringRecorder
from mastering.analyzer import analyze_wav
from mastering.apply import apply_corrections, revert_track


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mastering",
        description="Balance Sonic Pi tracks by measuring intrinsic instrument loudness.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--track", type=str, help="Master a single track (e.g. poolside)")
    group.add_argument("--all", action="store_true", help="Master all tracks in sonic_pi/")
    group.add_argument(
        "--revert", type=str, nargs="?", const="__all__",
        help="Revert track(s) to pre-mastering backup.",
    )
    parser.add_argument("--duration", type=float, default=5.0,
                        help="Recording duration per instrument (default: 5s)")
    parser.add_argument("--target-lufs", type=float, default=-23.0,
                        help="Target LUFS for the loudest instrument (default: -23.0)")
    parser.add_argument("--max-range", type=float, default=12.0,
                        help="Max allowed dB range between loudest and quietest (default: 12)")
    parser.add_argument("--threshold", type=float, default=1.5,
                        help="Skip corrections smaller than this dB (default: 1.5)")
    parser.add_argument("--skip-record", action="store_true",
                        help="Skip recording, use existing WAVs")
    parser.add_argument("--no-apply", action="store_true",
                        help="Analyze only, don't apply corrections")
    parser.add_argument("--output-dir", type=str, default="mastering_output",
                        help="Output directory (default: mastering_output)")
    parser.add_argument("--track-dir", type=str, default="sonic_pi",
                        help="Directory containing .rb track files (default: sonic_pi)")
    return parser.parse_args()


async def master_track(
    track_path: str,
    recorder: MasteringRecorder | None,
    output_dir: str,
    duration: float,
    target_lufs: float,
    max_range: float,
    threshold: float,
    skip_record: bool,
    apply: bool,
) -> None:
    """Master a single track end-to-end."""
    track_file = Path(track_path)
    track_name = track_file.stem

    print(f"\n{'='*60}")
    print(f"Mastering: {track_name}")
    print(f"{'='*60}")

    # 1. Extract instruments
    parts, loop_instruments, instruments = extract_instruments(track_path)
    print(f"\nFound {len(instruments)} unique instruments:")
    for inst in instruments:
        loops_using = [l for l, insts in loop_instruments.items() if inst.name in insts]
        print(f"  {inst.name:25} used by: {', '.join(loops_using)}")

    inst_dir = Path(output_dir) / track_name
    inst_dir.mkdir(parents=True, exist_ok=True)

    # 2. Record each instrument
    if not skip_record:
        if recorder is None:
            raise RuntimeError("Recorder not initialized")
        for inst in instruments:
            wav_path = inst_dir / f"{inst.safe_name}.wav"
            print(f"\n  Recording {inst.name}...")
            await recorder.record_instrument(inst.test_code, wav_path, duration)

    # 3. Analyze each instrument
    print(f"\nAnalyzing...")
    loudness_table: dict[str, float] = {}  # instrument_name -> LUFS

    for inst in instruments:
        wav_path = inst_dir / f"{inst.safe_name}.wav"
        if not wav_path.exists():
            print(f"  {inst.name}: NO RECORDING")
            continue
        analysis = analyze_wav(str(wav_path), track_name, inst.name)
        loudness_table[inst.name] = analysis.integrated_lufs
        print(f"  {inst.name:25} {analysis.integrated_lufs:>7.1f} LUFS  "
              f"Peak: {analysis.peak_db:>6.1f} dB")

    if not loudness_table:
        print("No analysis results.")
        return

    # 4. Compute per-loop corrections
    # Each instrument is normalized to target_lufs — a fixed global baseline.
    # Loud instruments get cut, quiet ones get boosted.
    valid = {k: v for k, v in loudness_table.items() if v > -70}
    if not valid:
        print("All instruments below -70 LUFS, nothing to correct.")
        return

    print(f"\n  Target baseline: {target_lufs:.1f} LUFS")
    print(f"\nPer-loop corrections:")

    # Build correction per loop based on its primary instrument
    loop_corrections: dict[str, dict] = {}

    for loop_name, inst_names in loop_instruments.items():
        # Use the loudest instrument in this loop as the reference
        loop_lufs_values = [loudness_table.get(i) for i in inst_names if i in loudness_table]
        loop_lufs_values = [v for v in loop_lufs_values if v is not None and v > -70]

        if not loop_lufs_values:
            print(f"  {loop_name:20} -- no measured instrument, skipping")
            continue

        loop_lufs = max(loop_lufs_values)

        # Simple: correct to the fixed baseline
        correction_db = target_lufs - loop_lufs

        # Cap extreme corrections — instruments more than max_range below
        # the baseline are inherently quiet by design (e.g. vinyl_hiss).
        # Don't boost them beyond max_range dB.
        if correction_db > max_range:
            correction_db = max_range

        multiplier = 10.0 ** (correction_db / 20.0)

        if abs(correction_db) < threshold:
            print(f"  {loop_name:20} {correction_db:+6.1f} dB  (skip, below threshold)")
            continue

        loop_corrections[loop_name] = {
            "loop_name": loop_name,
            "correction_db": round(correction_db, 1),
            "suggested_amp_multiplier": round(multiplier, 2),
            "instrument": inst_names[0] if inst_names else "?",
            "instrument_lufs": round(loop_lufs, 1),
        }
        direction = "boost" if correction_db > 0 else "cut"
        print(f"  {loop_name:20} {correction_db:+6.1f} dB  x{multiplier:.2f}  "
              f"({inst_names[0]}: {loop_lufs:.1f} LUFS)")

    # Save report
    report = {
        "track_name": track_name,
        "target_lufs": target_lufs,
        "instrument_loudness": {k: round(v, 1) for k, v in loudness_table.items()},
        "loop_corrections": loop_corrections,
    }
    report_path = inst_dir / "report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n  Report: {report_path}")

    # 5. Apply corrections
    if apply and loop_corrections:
        print(f"\nApplying corrections to {track_name}...")
        apply_corrections(
            track_path=track_path,
            report_path=str(report_path),
            threshold_db=threshold,
        )


async def main():
    args = parse_args()
    track_dir = Path(args.track_dir)

    # Revert mode
    if args.revert is not None:
        if args.revert == "__all__":
            for rb in sorted(track_dir.glob("*.rb")):
                revert_track(str(rb))
        else:
            revert_track(str(track_dir / f"{args.revert}.rb"))
        return

    # Discover tracks
    if args.track:
        tracks = [track_dir / f"{args.track}.rb"]
        if not tracks[0].exists():
            print(f"Track not found: {tracks[0]}")
            return
    else:
        tracks = sorted(track_dir.glob("*.rb"))

    # Boot recorder once
    recorder = None
    if not args.skip_record:
        recorder = MasteringRecorder(output_dir=args.output_dir)
        await recorder._ensure_booted()

    try:
        for track_path in tracks:
            await master_track(
                track_path=str(track_path),
                recorder=recorder,
                output_dir=args.output_dir,
                duration=args.duration,
                target_lufs=args.target_lufs,
                max_range=args.max_range,
                threshold=args.threshold,
                skip_record=args.skip_record,
                apply=not args.no_apply,
            )
    finally:
        if recorder:
            await recorder.shutdown()

    print(f"\n{'='*60}")
    print("Done. Use --revert to undo.")
    print(f"{'='*60}")
