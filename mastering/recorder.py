"""Recording orchestrator — boots Sonic Pi, records each solo loop to WAV."""

from __future__ import annotations

import asyncio
import glob
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Add project root to path so we can import sonic_pi.headless
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sonic_pi.headless import SonicPiHeadless
from mastering.parser import parse_track, TrackParts
from mastering.solo_gen import generate_solo


def _find_sonic_pi_recording() -> Path | None:
    """Find the latest WAV file in Sonic Pi's temp recording directory.

    Sonic Pi 4.x saves recordings to:
      %TEMP%/sonic-pi<session>/  (Windows)
    """
    temp_dir = tempfile.gettempdir()
    # Find all sonic-pi temp dirs
    sp_dirs = sorted(
        glob.glob(os.path.join(temp_dir, "sonic-pi*")),
        key=os.path.getmtime,
        reverse=True,
    )
    for sp_dir in sp_dirs:
        wavs = sorted(
            glob.glob(os.path.join(sp_dir, "*.wav")),
            key=os.path.getmtime,
            reverse=True,
        )
        if wavs:
            return Path(wavs[0])
    return None


def _clear_sonic_pi_recordings():
    """Remove existing WAV files from Sonic Pi temp dirs to avoid stale pickups."""
    temp_dir = tempfile.gettempdir()
    for sp_dir in glob.glob(os.path.join(temp_dir, "sonic-pi*")):
        for wav in glob.glob(os.path.join(sp_dir, "*.wav")):
            try:
                os.remove(wav)
            except OSError:
                pass


class MasteringRecorder:
    def __init__(self, output_dir: str = "mastering_output"):
        self.output_dir = Path(output_dir)
        self.sonic: SonicPiHeadless | None = None

    async def _ensure_booted(self):
        """Boot Sonic Pi if not already running."""
        if self.sonic is None or not self.sonic.is_running:
            self.sonic = SonicPiHeadless()
            await self.sonic.boot()

    async def _record_loop(
        self,
        track: TrackParts,
        loop_name: str,
        wav_path: Path,
        scenario: str,
        duration: float,
        reference: bool = False,
    ) -> bool:
        """Record a single isolated loop to WAV.

        Returns True if the WAV was created successfully.
        """
        # Generate the solo snippet (strip comments like run_file does)
        solo_code = generate_solo(track, loop_name, scenario, reference=reference)
        lines = solo_code.split("\n")
        solo_code = "\n".join(
            l for l in lines if l.strip() and not l.strip().startswith("#")
        )

        # Stop any running code and let scsynth settle
        await self.sonic.stop_code()
        await asyncio.sleep(1.5)

        # Clear any previous recordings so we pick up the right one
        _clear_sonic_pi_recordings()

        # Send the solo snippet
        await self.sonic.run_code(solo_code)
        await asyncio.sleep(1.5)  # let loop initialize and start producing sound

        # Start recording (no path arg — Sonic Pi 4.x saves to temp dir)
        await self.sonic.run_code("recording_start")
        print(f"  [REC] Recording {track.track_name}/{loop_name} for {duration}s...",
              flush=True)

        await asyncio.sleep(duration)

        # Stop recording
        await self.sonic.run_code("recording_stop")
        await asyncio.sleep(1.0)  # file flush

        # Stop the code
        await self.sonic.stop_code()
        await asyncio.sleep(0.5)

        # Find the recording in Sonic Pi's temp dir and move it
        src = _find_sonic_pi_recording()
        if src and src.exists() and src.stat().st_size > 0:
            shutil.move(str(src), str(wav_path))
            size_kb = wav_path.stat().st_size / 1024
            print(f"  [REC] Saved {wav_path.name} ({size_kb:.0f} KB)", flush=True)
            return True
        else:
            print(f"  [REC] WARNING: {loop_name}.wav — no recording found!", flush=True)
            return False

    async def record_track(
        self,
        track_path: str,
        duration: float = 15.0,
        event_duration: float = 20.0,
        scenario: str = "default",
        reference: bool = False,
    ) -> dict[str, Path]:
        """Record all loops from a track.

        Args:
            track_path: Path to the .rb track file.
            duration: Recording duration for continuous loops (seconds).
            event_duration: Recording duration for event/ambient loops (seconds).
            scenario: Test data scenario name.
            reference: If True, normalize all amps to a flat reference level.

        Returns:
            Dict mapping loop_name -> wav_path for successfully recorded loops.
        """
        track = parse_track(track_path)
        track_dir = self.output_dir / track.track_name
        track_dir.mkdir(parents=True, exist_ok=True)

        await self._ensure_booted()

        results: dict[str, Path] = {}
        total = len(track.loops)

        for idx, (loop_name, loop_info) in enumerate(track.loops.items(), 1):
            print(f"\n[{idx}/{total}] {track.track_name}/{loop_name}", flush=True)

            wav_path = track_dir / f"{loop_name}.wav"

            # Event and ambient loops get more time for triggers to fire
            dur = event_duration if (loop_info.is_event_loop or loop_info.is_ambient_loop) else duration

            ok = await self._record_loop(track, loop_name, wav_path, scenario, dur, reference=reference)
            if ok:
                results[loop_name] = wav_path

        return results

    async def record_all_tracks(
        self,
        track_dir: str = "sonic_pi",
        duration: float = 15.0,
        event_duration: float = 20.0,
        scenario: str = "default",
        reference: bool = False,
    ) -> dict[str, dict[str, Path]]:
        """Record all tracks in the given directory.

        Returns:
            Dict mapping track_name -> {loop_name: wav_path}.
        """
        track_path = Path(track_dir)
        rb_files = sorted(track_path.glob("*.rb"))

        if not rb_files:
            print(f"No .rb files found in {track_dir}", flush=True)
            return {}

        await self._ensure_booted()

        all_results: dict[str, dict[str, Path]] = {}

        for rb_file in rb_files:
            print(f"\n{'='*60}", flush=True)
            print(f"Recording track: {rb_file.stem}", flush=True)
            print(f"{'='*60}", flush=True)

            results = await self.record_track(
                str(rb_file), duration, event_duration, scenario, reference=reference
            )
            all_results[rb_file.stem] = results

        return all_results

    async def record_instrument(
        self,
        test_code: str,
        wav_path: Path,
        duration: float = 5.0,
    ) -> bool:
        """Record a simple instrument test snippet to WAV.

        Args:
            test_code: Ruby code that plays the instrument once.
            wav_path: Where to save the recording.
            duration: How long to record (seconds).

        Returns True if WAV was created successfully.
        """
        await self._ensure_booted()

        # Strip comments
        lines = test_code.split("\n")
        clean = "\n".join(l for l in lines if l.strip() and not l.strip().startswith("#"))

        # Stop previous, clear recordings
        await self.sonic.stop_code()
        await asyncio.sleep(1.5)
        _clear_sonic_pi_recordings()

        # Start recording first (captures from the start)
        await self.sonic.run_code("recording_start")
        await asyncio.sleep(0.5)

        # Play the instrument
        await self.sonic.run_code(clean)
        await asyncio.sleep(duration)

        # Stop
        await self.sonic.run_code("recording_stop")
        await asyncio.sleep(1.0)
        await self.sonic.stop_code()
        await asyncio.sleep(0.5)

        # Find and move the recording
        src = _find_sonic_pi_recording()
        if src and src.exists() and src.stat().st_size > 0:
            wav_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(wav_path))
            size_kb = wav_path.stat().st_size / 1024
            print(f"    Saved {wav_path.name} ({size_kb:.0f} KB)", flush=True)
            return True
        else:
            print(f"    WARNING: no recording captured!", flush=True)
            return False

    async def shutdown(self):
        """Shut down Sonic Pi."""
        if self.sonic:
            await self.sonic.shutdown()
            self.sonic = None
