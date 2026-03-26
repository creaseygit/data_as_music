# Writing Tracks

New `.rb` files in `sonic_pi/` are auto-discovered by the web UI. A track must:

1. **Set defaults** so the track plays immediately without market data:

```ruby
set :heat, 0.4
set :price, 0.5
set :velocity, 0.2
set :trade_rate, 0.3
set :spread, 0.2
set :tone, 1
set :event_spike, 0
set :event_price_move, 0
set :market_resolved, 0
set :ambient_mode, 0
```

2. **Read raw data** with `get(:heat)`, `get(:price)`, etc. in live_loops. Python pushes new values every 3s via `run_code`/`set` — they take effect on next `get()`.

3. **Map data to music however you want.** The track is the artist's canvas:
   - Any number of instruments/layers
   - Any mapping logic (heat → volume, price → pitch, trade_rate → rhythm density, etc.)
   - Any genre, any structure

4. **Treat amp as relative volume** — the mastering pipeline normalizes all instruments to equal loudness, so `amp: 0.3` on any synth/sample produces the same perceived volume. Use `set_volume! 0.7` for master headroom, keep individual amps under 0.5. After writing a track, run `python -m mastering --all` to apply normalization factors.

5. **Keep the file concise** — under ~14KB raw. `run_file` strips comments automatically, but stay within budget

6. **Do not use Sonic Pi reserved names as variables** — e.g., `range`, `tick`, `ring`, `play`, `sample`, `sleep`

7. **Use correct chord names** — `:major7`, `:minor7`, `:maj9`, `:m9`, `:dom7` (NOT `:major9`, `:minor9`, `:M9`)

8. **Declare metadata** at the top of the `.rb` file before the `set` defaults:
   ```ruby
   # @category music
   # @label My Track Name
   ```
   Category is `"music"` (continuous generative music) or `"alert"` (reactive event sounds). Defaults to `"music"` if omitted. Label defaults to the filename in title case

See `midnight_ticker.rb` for the full data interface, `oracle.rb` for a minimal price-only approach. Use the **Track Sandbox** (`/sandbox`) to test tracks with manual slider control.

## Existing Tracks

### oracle.rb
Minimal piano-only track with a single `price_watch` loop. Responds to any price movement > 1¢:
- **`price_watch`** — Detects price deltas > 1¢. Plays ascending/descending piano motifs (2–6 notes) scaling with move magnitude. C major when bullish, A minor when bearish. Volume scales with velocity, trade_rate, and move magnitude but kept quiet (master volume 0.3, per-note amp capped at 0.05)

Reads `:price`, `:tone`, `:velocity`, `:trade_rate`. Ignores heat, spread, events, resolution.

### mezzanine.rb
Sigur Rós "Teardrop"-inspired ambient track, BPM 80. Am → Am → F → G progression. Features teardrop arpeggio (pluck), sub bass, bass line (tb303 with 4 phrase variants), kick, kick ghost, snare, ambient pad. Velocity-driven octave jumps in arpeggio. Heat-driven inverse amp (louder when calm).

### just_vibes.rb
Lo-fi hip hop track, BPM 75. Key: F major / D minor. Chord clock syncs all harmonic loops via shared `chord_idx`. Rhythmic bed: kick (half-time), snare (beat 3 with reverb), hats, rim clicks, sub bass (sine), warm bass (tb303, very low cutoff, 4 randomized phrases), hollow pad (inverse to heat), vinyl hiss, deep echo. Melodic elements only on market movement: piano motifs on price drift > 2¢, 7-note piano arpeggio on event_price_move, resolution figure. Tone-aware progressions: Fmaj7→Em7→Dm7→Cmaj7 (bullish) / Dm7→Bbmaj7→Gm7→Am7 (bearish).

## Mastering Pipeline

The mastering pipeline (`python -m mastering --all`) ensures all synths and samples produce equal perceived loudness at the same `amp:` value. It multiplies each `amp:` expression by a per-instrument factor (e.g., `amp: 0.18 * 0.85  # ~nf`). Lines marked `# ~nf` have been normalized.

**When writing tracks:** Set amp values based on the mix role you want — louder for leads/kicks, quieter for textures/ambience. Don't worry about intrinsic instrument loudness differences; the mastering pipeline handles that.

**After writing/modifying tracks:** Run `python -m mastering --all` to apply normalization. Use `--revert` to undo.

Located in `mastering/` with its own docs at `mastering/MASTERING.md`. Workflow:

1. `instruments.py` — Extract all unique synths/samples from .rb files
2. `recorder.py` — Boot Sonic Pi headless, play each instrument at amp=0.3, record 5s WAV
3. `analyzer.py` — Measure LUFS (integrated loudness) using librosa + pyloudnorm
4. `apply.py` — Parse each .rb, find `amp:` expressions, multiply by per-instrument factor, mark with `# ~nf`
5. Output: `mastering_output/normalization_table.json`

Extra deps: `pip install -r requirements-mastering.txt` (pyloudnorm, librosa, soundfile, numpy)
