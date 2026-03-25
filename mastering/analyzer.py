"""Audio analysis — LUFS, RMS, peak, spectral analysis per WAV file."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf
import pyloudnorm as pyln


@dataclass
class LayerAnalysis:
    track_name: str
    loop_name: str
    wav_path: str
    duration_seconds: float
    # Loudness
    integrated_lufs: float
    rms_db: float
    peak_db: float
    # Spectral
    spectral_centroid_hz: float
    frequency_band_energy: dict[str, float] = field(default_factory=dict)
    # Classification
    is_event_loop: bool = False
    is_silent: bool = False


def _safe_db(val: float) -> float:
    """Convert linear amplitude to dB, handling zero/negative."""
    if val <= 0:
        return -120.0
    return 20.0 * math.log10(val)


def _compute_band_energy(
    audio_mono: np.ndarray, rate: int
) -> dict[str, float]:
    """Compute energy in frequency bands using FFT.

    Bands: sub (20-80Hz), bass (80-300Hz), mid (300-4kHz), high (4k-20kHz).
    Returns energy in dB per band.
    """
    n = len(audio_mono)
    if n == 0:
        return {"sub": -120.0, "bass": -120.0, "mid": -120.0, "high": -120.0}

    # Use windowed FFT for better spectral estimation
    window = np.hanning(n)
    spectrum = np.abs(np.fft.rfft(audio_mono * window)) ** 2
    freqs = np.fft.rfftfreq(n, d=1.0 / rate)

    bands = {
        "sub": (20, 80),
        "bass": (80, 300),
        "mid": (300, 4000),
        "high": (4000, min(20000, rate // 2)),
    }

    result = {}
    for band_name, (lo, hi) in bands.items():
        mask = (freqs >= lo) & (freqs < hi)
        energy = np.sum(spectrum[mask])
        # Normalize by number of bins to make it comparable
        n_bins = max(np.sum(mask), 1)
        avg_energy = energy / n_bins
        result[band_name] = _safe_db(math.sqrt(avg_energy)) if avg_energy > 0 else -120.0

    return result


def _compute_spectral_centroid(audio_mono: np.ndarray, rate: int) -> float:
    """Compute spectral centroid in Hz."""
    n = len(audio_mono)
    if n == 0:
        return 0.0

    spectrum = np.abs(np.fft.rfft(audio_mono))
    freqs = np.fft.rfftfreq(n, d=1.0 / rate)

    total_magnitude = np.sum(spectrum)
    if total_magnitude == 0:
        return 0.0

    return float(np.sum(freqs * spectrum) / total_magnitude)


def analyze_wav(
    wav_path: str,
    track_name: str,
    loop_name: str,
    is_event_loop: bool = False,
) -> LayerAnalysis:
    """Analyze a single WAV file for loudness and spectral content."""
    audio, rate = sf.read(wav_path, dtype="float64")

    # Convert to mono for spectral analysis
    if audio.ndim == 2:
        audio_mono = np.mean(audio, axis=1)
    else:
        audio_mono = audio

    duration = len(audio_mono) / rate

    # -- Loudness --

    # Integrated LUFS (ITU-R BS.1770)
    meter = pyln.Meter(rate)
    # pyloudnorm expects shape (samples,) for mono or (samples, channels) for stereo
    try:
        integrated_lufs = meter.integrated_loudness(audio)
    except Exception:
        integrated_lufs = -120.0

    # Handle -inf from pyloudnorm (silent audio)
    if math.isinf(integrated_lufs):
        integrated_lufs = -120.0

    # RMS
    rms = math.sqrt(np.mean(audio_mono ** 2))
    rms_db = _safe_db(rms)

    # Peak
    peak = float(np.max(np.abs(audio_mono)))
    peak_db = _safe_db(peak)

    # Silence detection — use LUFS (perceptually weighted) not RMS.
    # RMS is misleadingly low for transient layers (short stabs, hats)
    # while LUFS correctly captures their perceived loudness.
    is_silent = integrated_lufs <= -70.0

    # -- Spectral --
    spectral_centroid = _compute_spectral_centroid(audio_mono, rate)
    band_energy = _compute_band_energy(audio_mono, rate)

    return LayerAnalysis(
        track_name=track_name,
        loop_name=loop_name,
        wav_path=wav_path,
        duration_seconds=round(duration, 2),
        integrated_lufs=round(integrated_lufs, 1),
        rms_db=round(rms_db, 1),
        peak_db=round(peak_db, 1),
        spectral_centroid_hz=round(spectral_centroid, 0),
        frequency_band_energy={k: round(v, 1) for k, v in band_energy.items()},
        is_event_loop=is_event_loop,
        is_silent=is_silent,
    )


def analyze_track(
    track_name: str,
    wav_dir: str,
    track_parts=None,
) -> list[LayerAnalysis]:
    """Analyze all WAV files in a track's output directory.

    Args:
        track_name: Name of the track (e.g. "midnight_ticker").
        wav_dir: Directory containing per-loop WAV files.
        track_parts: Optional TrackParts for classification metadata.

    Returns:
        List of LayerAnalysis, one per WAV file found.
    """
    wav_path = Path(wav_dir)
    if not wav_path.exists():
        print(f"  [ANALYZE] Directory not found: {wav_dir}")
        return []

    wavs = sorted(wav_path.glob("*.wav"))
    if not wavs:
        print(f"  [ANALYZE] No WAV files in {wav_dir}")
        return []

    results = []
    for wav_file in wavs:
        loop_name = wav_file.stem

        # Check if this is an event loop
        is_event = False
        if track_parts and loop_name in track_parts.loops:
            loop_info = track_parts.loops[loop_name]
            is_event = loop_info.is_event_loop or loop_info.is_ambient_loop

        print(f"  [ANALYZE] {track_name}/{loop_name}...", flush=True)
        analysis = analyze_wav(
            str(wav_file), track_name, loop_name, is_event_loop=is_event
        )
        results.append(analysis)

        status = "SILENT" if analysis.is_silent else f"{analysis.integrated_lufs} LUFS"
        print(f"           {status} | RMS {analysis.rms_db} dB | "
              f"Peak {analysis.peak_db} dB | Centroid {analysis.spectral_centroid_hz} Hz",
              flush=True)

    return results
