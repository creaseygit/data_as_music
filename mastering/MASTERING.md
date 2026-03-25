# Mastering Pipeline — Status & Spec

## Problem

Each Sonic Pi track has 10-16 live_loops using different synths and samples. These instruments have wildly different intrinsic loudness at the same `amp:` value — e.g. `:sine` at `amp: 0.3` measures -31.9 LUFS, while `:hollow` at `amp: 0.3` measures -49.2 LUFS. That's a 17 dB gap. The result is that authored `amp:` values don't produce predictable volume — a loop using `:piano` with `amp: 0.08` can be louder than a loop using `:hollow` with `amp: 0.5`.

## What's Built

### Pipeline (`mastering/`)

```
python -m mastering --track poolside --duration 4
```

**Step 1 — Extract instruments** (`instruments.py`):
Parses a `.rb` track file, finds every unique `use_synth :name` / `synth :name` / `sample :name`, and maps which loops use which instruments.

**Step 2 — Record each instrument** (`recorder.py`):
Boots Sonic Pi headless, plays each instrument once at a fixed reference amp (0.3) and records it to WAV via `recording_start`/`recording_stop`. Sonic Pi saves recordings to `%TEMP%/sonic-pi*/`, the recorder finds and moves them.

**Step 3 — Analyze** (`analyzer.py`):
Measures each WAV: integrated LUFS (ITU-R BS.1770 via pyloudnorm), RMS dBFS, peak dBFS, spectral centroid, frequency band energy.

**Step 4 — Compute corrections** (`cli.py`):
For each loop, looks up its instrument's measured LUFS and computes `correction_db = target_lufs - instrument_lufs`. Converts to an amp multiplier: `10^(correction_db/20)`.

**Step 5 — Apply** (`apply.py`):
Wraps each corrected loop body in `with_fx :level, amp: X do # [mastering] ... end`. Backs up originals to `.rb.bak`.

### Other modules
- `parser.py` — Parses `.rb` track files into structured parts (live_loops, defines, defaults, sync deps, top-level vars). Well-tested, works on all 4 tracks.
- `solo_gen.py` — Generates standalone `.rb` snippets per live_loop. Was used in earlier approach (recording whole loops), still works but not used by the current instrument-based pipeline.
- `reporter.py` — Generates text/JSON balance reports. Was used in earlier approach, not used by current pipeline.

### Recordings on disk
`mastering_output/{track_name}/` has WAV recordings for both the old per-loop approach and the new per-instrument approach. The instrument recordings are named `{synth_name}.wav` or `sample_{sample_name}.wav`.

### CLI
```
python -m mastering --track NAME     # single track
python -m mastering --all            # all tracks
python -m mastering --revert         # restore all from .bak
python -m mastering --revert NAME    # restore one track

Options:
  --duration SECS        Recording duration per instrument (default: 5)
  --target-lufs FLOAT    Target baseline LUFS (default: -23.0)
  --max-range FLOAT      Cap corrections at this many dB (default: 12)
  --threshold FLOAT      Skip corrections below this dB (default: 1.5)
  --skip-record          Reuse existing WAVs, just re-analyze and apply
  --no-apply             Analyze only, don't modify tracks
  --output-dir DIR       Where to put WAVs and reports (default: mastering_output)
```

## What's Wrong

The fundamental issue is that the correction logic doesn't account for the **authored amp values** already in the track. It only measures intrinsic instrument loudness and applies a flat correction per loop. This means:

### 1. The correction ignores what the track author intended

Oracle's `price_watch` uses `amp: 0.08-0.18` (deliberately quiet piano touches). The mastering pipeline sees "piano is intrinsically at -37.7 LUFS" and applies x3.98 to the entire loop. But the loop is already quiet *on purpose* — the x3.98 multiplier combines with the authored amps to produce distortion.

The correction should be: `target / (intrinsic * authored_amp)`, not just `target / intrinsic`.

### 2. Loops play notes differently than the test

The test records `:piano` playing middle C once at `amp: 0.3`. But oracle's `price_watch` plays *multiple rapid notes* in quick succession with reverb — the cumulative energy is much higher than a single note. Similarly, poolside's `piano_chords` plays *chords* (multiple simultaneous notes), which are inherently louder than single notes.

### 3. A flat target LUFS doesn't make sense for a mix

Not every layer should be at the same volume. A kick at -23 LUFS and a hi-hat shimmer at -23 LUFS would be wrong — hats should be quieter. The corrections need to respect the **role** of each layer (foundation vs detail vs accent).

### 4. Max-range cap creates a ceiling where everything gets the same correction

With a 12 dB cap, most instruments end up capped at +12 dB, making the corrections nearly uniform. This defeats the purpose — it's just a global volume boost.

## Measured Instrument Loudness (at amp: 0.3)

These are consistent across recording sessions:

| Instrument | LUFS | Category |
|---|---|---|
| sine | -26.6 to -31.9 | Loud (varies by track BPM) |
| sample:bd_haus | -30.4 to -37.4 | Loud |
| sample:bd_fat | -43.4 | Medium |
| tb303 | -34.4 to -35.4 | Medium |
| saw | -34.9 to -36.1 | Medium |
| sample:drum_tom_lo_hard | -35.8 | Medium |
| sample:drum_cymbal_open | -36.6 | Medium |
| sample:sn_dub | -37.1 | Medium |
| piano | -37.7 to -39.0 | Medium |
| blade | -39.6 | Medium-Quiet |
| sample:drum_cymbal_hard | -40.1 | Medium-Quiet |
| sample:drum_cowbell | -33.6 | Medium |
| sample:drum_cymbal_soft | -44.8 | Quiet |
| sample:bd_fat | -43.4 | Quiet |
| sample:drum_cymbal_closed | -46.2 | Quiet |
| pluck | -46.4 | Quiet |
| hollow | -46.8 to -49.2 | Quiet |
| dark_ambience | -61.0 | Very Quiet |
| sample:vinyl_hiss | -64.4 | Very Quiet |
| zpad | -120.0 | Broken (doesn't exist in Sonic Pi 4.6) |

## What Needs to Change

The pipeline infrastructure (recording, analysis, apply) works fine. The **correction logic** needs rethinking. Possible approaches:

### Option A: Correct the authored amps, not the loop

Instead of wrapping the whole loop in `with_fx :level`, adjust the actual `amp:` values in the code. For each `play`/`sample`/`synth` call, multiply its amp by `(target / intrinsic_loudness)`. This normalizes the instrument while preserving the author's relative dynamics.

Problem: Parsing and rewriting Ruby amp expressions is fragile.

### Option B: Build a loudness lookup table, use it when writing tracks

Don't auto-correct existing tracks. Instead, provide a reference table that track authors use when setting amp values. If `:hollow` is 17 dB quieter than `:sine`, the author knows to use ~7x higher amp for hollow layers. This is a tool for humans, not an auto-fixer.

### Option C: Record the actual mix, not isolated instruments

Record each live_loop as it actually plays in the track (the old approach, with the correct amp values and data-driven behavior). Measure the actual loudness of each layer in context. Then correct the outliers — loops that are too loud or too quiet relative to the rest of the mix.

Problem: This was the first approach attempted and had issues with conditional loops being silent under default data scenarios. Reference mode (normalizing amps) was tried to solve this but that removes the authored intent. Using `high_activity` data opens all gates but the amp values are still authored, so the measurement reflects authored intent + intrinsic loudness combined — which is actually what you want to measure.

### Option D: Hybrid — normalize intrinsic loudness, then mix

1. Use the measured intrinsic loudness table to compute a **per-instrument normalization factor** (so every instrument at `amp: 0.3` would produce the same LUFS).
2. Bake this normalization into each `play`/`sample` call as a multiplier.
3. Now the track author's `amp:` values directly control the mix balance, because all instruments have been leveled.

This is the cleanest solution but requires rewriting amp values in the Ruby code.

## Dependencies

```
# requirements-mastering.txt
pyloudnorm>=0.1.0
librosa>=0.10.0
soundfile>=0.12.0
numpy>=1.24.0
```

## Files

| File | Status | Purpose |
|---|---|---|
| `mastering/__init__.py` | Done | Package init |
| `mastering/__main__.py` | Done | `python -m mastering` entry |
| `mastering/cli.py` | Needs rework | CLI + correction logic |
| `mastering/parser.py` | Done, solid | Parses .rb track files |
| `mastering/instruments.py` | Done | Extracts instruments, generates test snippets |
| `mastering/recorder.py` | Done | Records via Sonic Pi headless |
| `mastering/analyzer.py` | Done | LUFS/RMS/spectral analysis |
| `mastering/apply.py` | Done, may need rework | Applies `with_fx :level` corrections |
| `mastering/solo_gen.py` | Done, unused by current pipeline | Generates per-loop solo snippets |
| `mastering/reporter.py` | Done, unused by current pipeline | Text/JSON balance reports |
| `mastering_output/` | Has recordings | WAVs + reports per track |
| `.gitignore` | Updated | Excludes `mastering_output/` |
| `requirements-mastering.txt` | Done | Extra deps for mastering |

## Known Issues

- **Sonic Pi `recording_start` takes no args** — Sonic Pi 4.x saves to `%TEMP%/sonic-pi*/`. The recorder finds and moves the WAV after each recording. Need ~1.5s settle time between recordings or the file isn't found.
- **`:zpad` synth doesn't exist** in Sonic Pi 4.6. `midnight_ticker`'s events loop references it — records as silence.
- **`:spread` is a reserved word** in Sonic Pi's pre-parser. Comment lines containing the word `spread` trigger errors when sent via `run_code`. The recorder strips comments before sending.
- **Samples could be analyzed from disk** instead of recording them through Sonic Pi. They're WAV files in the Sonic Pi install directory. This would save recording time and give more accurate measurements (no scsynth/recording chain in the way). Not implemented yet.
- **Synth LUFS varies slightly by BPM** — `use_bpm` affects Sonic Pi's internal timing which can slightly change how scsynth renders the sound. Measured variance is ~1-2 dB.
