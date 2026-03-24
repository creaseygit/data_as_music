# Market Pulse — Polymarket Generative Track
# A clean, professional ambient electronic track driven by market data.
#
# Architecture:
#   - Kick: Punchy electronic kick, density from trade rate
#   - Bass: Smooth sub bass, root from market probability
#   - Chords: Lush pad chords, voicing from market sentiment
#   - Melody: Evolving lead line, activity from trade velocity
#   - Atmosphere: Textural background, depth from market volatility
#
# All params set via run_code from Python (set :kick_amp, etc.)
# Amp range: 0.0 - 0.8 (headroom safe)

use_bpm 120
use_debug false

# ─── Defaults (silent until Python sends data) ───────────
[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  set :"#{layer}_amp",     0.0
  set :"#{layer}_cutoff",  80.0
  set :"#{layer}_reverb",  0.3
  set :"#{layer}_density", 0.5
  set :"#{layer}_tone",    1
  set :"#{layer}_tension", 0.0
end

set :market_resolved, 0
set :ambient_mode,    0

# ─── Musical constants ───────────────────────────────────
MAJOR_CHORDS = [
  chord(:e3, :major7),
  chord(:a3, :major7),
  chord(:d3, :major9),
  chord(:b2, :minor7),
]

MINOR_CHORDS = [
  chord(:e3, :minor7),
  chord(:a3, :minor7),
  chord(:d3, :minor9),
  chord(:g3, :minor7),
]

MAJOR_SCALE = scale(:e4, :major_pentatonic, num_octaves: 2)
MINOR_SCALE = scale(:e4, :minor_pentatonic, num_octaves: 2)

# ─── KICK ─────────────────────────────────────────────────
# Clean electronic kick with ghost notes at high density
live_loop :kick_loop do
  amp     = get(:kick_amp)
  density = get(:kick_density)

  if amp < 0.05
    sleep 1
  else
    # Main hits on 1 and 3
    sample :bd_tek, amp: amp * 0.7, cutoff: 100
    sleep 1

    # Ghost hit on the "and" of 2 at high density
    if density > 0.5
      sample :bd_tek, amp: amp * 0.25, cutoff: 80
    end
    sleep 0.5

    # Offbeat at very high density
    if density > 0.8
      sample :bd_tek, amp: amp * 0.15, cutoff: 70
    end
    sleep 0.5
  end
end

# ─── HI-HAT ──────────────────────────────────────────────
# Crisp hats, ride the kick density
live_loop :hihat_loop do
  amp     = get(:kick_amp)
  density = get(:kick_density)

  if amp < 0.05
    sleep 0.5
  else
    # Closed hat on every 8th note
    if density > 0.3
      sample :drum_cymbal_closed,
        amp: amp * 0.2 * [0.6, 0.4, 0.5, 0.3].tick(:hh),
        rate: 1.2,
        finish: 0.1
    end
    sleep 0.5

    # Open hat on the "and" occasionally
    if density > 0.6 and one_in(4)
      sample :drum_cymbal_open,
        amp: amp * 0.12,
        rate: 1.5,
        finish: 0.15
    end
  end
end

# ─── BASS ─────────────────────────────────────────────────
# Warm sub bass with subtle movement
live_loop :bass_loop do
  amp     = get(:bass_amp)
  cutoff  = get(:bass_cutoff)
  tone    = get(:bass_tone)
  tension = get(:bass_tension)

  if amp < 0.05
    sleep 2
  else
    use_synth :subpulse

    # Root note: bullish = E, bearish = D
    root = tone == 1 ? :e2 : :d2
    # Add tension with note choice
    notes = tension > 0.5 ? [root, root + 5, root + 7] : [root, root + 7, root + 12]

    note = notes.tick(:bass_note)
    with_fx :lpf, cutoff: [cutoff, 90].min do
      play note,
        amp: amp * 0.6,
        attack: 0.05,
        sustain: 1.5,
        release: 0.4,
        cutoff: [cutoff, 85].min
    end
    sleep [2, 2, 1, 1].ring.tick(:bass_rhythm)
  end
end

# ─── CHORDS / PAD ────────────────────────────────────────
# Lush evolving pad — the harmonic center
live_loop :pad_loop do
  amp    = get(:pad_amp)
  reverb = get(:pad_reverb)
  tone   = get(:pad_tone)
  cutoff = get(:pad_cutoff)
  tension = get(:pad_tension)

  if amp < 0.05
    sleep 4
  else
    use_synth :hollow

    chords = tone == 1 ? MAJOR_CHORDS : MINOR_CHORDS
    c = chords.tick(:pad_chord)

    with_fx :reverb, room: [reverb, 0.9].min, mix: 0.6, damp: 0.5 do
      with_fx :lpf, cutoff: cutoff + 15 do
        # Play chord spread across time for shimmer
        c.each_with_index do |n, i|
          play n,
            amp: amp * 0.18,
            attack: 1.0 + (i * 0.3),
            sustain: 4,
            release: 2,
            pan: (i - 1.5) * 0.3  # spread stereo
        end
      end
    end
    sleep 8
  end
end

# ─── MELODY / LEAD ───────────────────────────────────────
# Evolving melodic line — sparse when calm, active when hot
live_loop :lead_loop do
  amp     = get(:lead_amp)
  density = get(:lead_density)
  cutoff  = get(:lead_cutoff)
  tone    = get(:lead_tone)
  reverb  = get(:lead_reverb)

  if amp < 0.05
    sleep 1
  else
    use_synth :prophet

    notes = tone == 1 ? MAJOR_SCALE : MINOR_SCALE

    with_fx :reverb, room: [reverb * 0.8, 0.7].min, mix: 0.4 do
      with_fx :echo, phase: 0.75, decay: 4, mix: 0.25 do
        with_fx :lpf, cutoff: cutoff + 20 do
          if density > 0.5 or one_in(3)
            # Pick note based on density — higher = more varied
            note_idx = density > 0.7 ? rand_i(notes.length) : [0, 2, 4, 7].choose
            n = notes[note_idx % notes.length]

            play n,
              amp: amp * 0.3,
              attack: 0.05,
              release: [0.5, 1.0, 1.5, 2.0].choose,
              cutoff: cutoff + 10,
              pan: rrand(-0.4, 0.4)
          end
        end
      end
    end

    # Rhythm varies with density
    sleep density > 0.7 ? [0.5, 0.5, 1.0].choose : [1.0, 1.5, 2.0].choose
  end
end

# ─── ATMOSPHERE ───────────────────────────────────────────
# Deep textural background — breathes with the market
live_loop :atmos_loop do
  amp    = get(:atmos_amp)
  reverb = get(:atmos_reverb)
  tone   = get(:atmos_tone)

  if amp < 0.05
    sleep 8
  else
    use_synth :hollow

    root = tone == 1 ? :e2 : :d2
    notes = [root, root + 7, root + 12, root + 19]

    with_fx :reverb, room: 0.95, mix: 0.8, damp: 0.3 do
      with_fx :lpf, cutoff: 75 do
        n = notes.choose
        play n,
          amp: amp * 0.12,
          attack: 4,
          sustain: 6,
          release: 4
      end
    end
    sleep 12
  end
end

# ─── TEXTURE — subtle rhythmic shimmer ────────────────────
live_loop :texture_loop do
  amp     = get(:pad_amp)
  density = get(:pad_density)
  tone    = get(:pad_tone)

  if amp < 0.05 or density < 0.3
    sleep 4
  else
    use_synth :blade

    notes = tone == 1 ? MAJOR_SCALE : MINOR_SCALE

    with_fx :reverb, room: 0.7, mix: 0.5 do
      with_fx :echo, phase: 0.375, decay: 3, mix: 0.2 do
        if one_in(2)
          n = notes.choose
          play n + 12,  # octave up for sparkle
            amp: amp * 0.08,
            attack: 0.01,
            release: 0.3,
            pan: rrand(-0.6, 0.6)
        end
      end
    end
    sleep [0.5, 0.75, 1.0].choose
  end
end

# ─── MARKET RESOLVED — dramatic event ────────────────────
live_loop :resolution_check do
  resolved = get(:market_resolved)
  if resolved != 0
    if resolved == 1
      # YES — triumphant ascending arpeggio
      use_synth :prophet
      with_fx :reverb, room: 0.8, mix: 0.5 do
        notes = [:e4, :g4, :b4, :e5, :g5]
        notes.each_with_index do |n, i|
          play n, amp: 0.4, release: 1.5 - (i * 0.2), pan: (i - 2) * 0.2
          sleep 0.2
        end
        play :b5, amp: 0.35, release: 3.0  # sustain the top note
      end
    else
      # NO — descending minor resolution
      use_synth :prophet
      with_fx :reverb, room: 0.9, mix: 0.6 do
        notes = [:b4, :g4, :e4, :d4, :b3]
        notes.each_with_index do |n, i|
          play n, amp: 0.4, release: 1.0, cutoff: 80 - (i * 5)
          sleep 0.25
        end
      end
    end
    set :market_resolved, 0
    sleep 4
  else
    sleep 1
  end
end

# ─── AMBIENT MODE — when nothing is hot ──────────────────
live_loop :ambient_check do
  if get(:ambient_mode) == 1
    use_synth :hollow
    with_fx :reverb, room: 0.98, mix: 0.85 do
      play scale(:e2, :minor).choose,
        amp: 0.08,
        attack: 6,
        release: 10
    end
    sleep 16
  else
    sleep 4
  end
end
