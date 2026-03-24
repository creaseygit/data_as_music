# Market Pulse v3 — Polymarket Generative Track
# Per-layer param differentiation, structural phrasing, swing, event stingers
use_bpm 120
use_debug false
set_volume! 0.7

[:kick, :bass, :pad, :lead, :atmos].each do |layer|
  set :"#{layer}_amp",     0.4
  set :"#{layer}_cutoff",  80.0
  set :"#{layer}_reverb",  0.3
  set :"#{layer}_density", 0.5
  set :"#{layer}_tone",    1
  set :"#{layer}_tension", 0.0
  set :"#{layer}_swing",   0.0
end
set :market_resolved, 0
set :ambient_mode, 0
set :lead_note_idx, 0
set :event_spike, 0
set :event_price_move, 0
set :phrase_bar, 0

MAJOR_CHORDS = [chord(:e3, :major7), chord(:a3, :major7), chord(:d3, :maj9), chord(:b2, :major7)]
MINOR_CHORDS = [chord(:e3, :minor7), chord(:a3, :minor7), chord(:d3, :minor7), chord(:g3, :m9)]
MAJOR_SCALE = scale(:e4, :major_pentatonic, num_octaves: 2)
MINOR_SCALE = scale(:e4, :minor_pentatonic, num_octaves: 2)
MAJOR_ROOTS = (ring :e2, :a2, :d2, :b1)
MINOR_ROOTS = (ring :e2, :a2, :d2, :g2)

define :sv do |val, in_lo, in_hi, out_lo, out_hi|
  span = (in_hi - in_lo).to_f
  span = 0.0001 if span < 0.0001
  n = [(val - in_lo) / span, 0.0].max
  n = [n, 1.0].min
  out_lo + n * (out_hi - out_lo)
end

# 32-bar structural cycle
live_loop :bar_clock do
  set :phrase_bar, (get(:phrase_bar) + 1) % 32
  sleep 2
end

# ── KICK ─────────────────────────────────────────────────
live_loop :kick_loop do
  amp = get(:kick_amp)
  density = get(:kick_density)
  sw = get(:kick_swing)
  bar = get(:phrase_bar)
  if amp < 0.05
    sleep 2
  elsif bar >= 24 and bar < 28
    # Breakdown — kick drops out, just a sub thud every 2 bars
    if bar.even?
      sample :bd_boom, amp: amp * 0.25, cutoff: 60, rate: 0.7
    end
    sleep 2
  elsif bar >= 28
    # Build — accelerating kicks
    build = (bar - 28) / 4.0
    4.times do |i|
      sample :bd_tek, amp: amp * (0.4 + build * 0.3), cutoff: 85 + (build * 15)
      sleep 0.5
    end
  else
    # Main pattern with swing
    sample :bd_tek, amp: amp * 0.7, cutoff: 100
    sample :bd_haus, amp: amp * 0.2, cutoff: 65, rate: 0.85 if density > 0.35
    sleep 1.0 + sw
    if density > 0.5 and rand < 0.3
      sample :bd_tek, amp: amp * 0.15, cutoff: 70, rate: 1.05
    end
    sleep 0.5 - sw
    sample :bd_tek, amp: amp * 0.6, cutoff: 95
    sleep 0.5
  end
end

# ── SNARE ────────────────────────────────────────────────
live_loop :snare_loop do
  amp = get(:kick_amp)
  density = get(:kick_density)
  tension = get(:kick_tension)
  bar = get(:phrase_bar)
  if amp < 0.08
    sleep 2
  elsif bar >= 24 and bar < 28
    # Breakdown — rimshot only
    sleep 1
    sample :elec_pop, amp: amp * 0.12, rate: 1.1
    sleep 1
  elsif bar >= 30
    # Fill — snare roll
    8.times do |i|
      sample :sn_dub, amp: amp * (0.1 + i * 0.03), rate: rrand(0.98, 1.04)
      sleep 0.25
    end
  else
    sleep 1
    snare_samp = (tick(:sn_var) % 4 < 3) ? :sn_dub : :drum_snare_hard
    sample snare_samp, amp: amp * 0.32, rate: rrand(0.97, 1.03)
    # Ghost note before beat 4
    sleep 0.75
    if rand < density * 0.4
      sample :sn_dub, amp: amp * 0.07, rate: 1.15, finish: 0.15
    end
    sleep 0.25
    sample snare_samp, amp: amp * 0.28, rate: rrand(0.98, 1.02), pan: rrand(-0.08, 0.08)
    # Occasional flam on tense markets
    if one_in(6) and tension > 0.4
      sleep 0.04
      sample :sn_dub, amp: amp * 0.12, rate: 1.08
      sleep 0.96
    else
      sleep 1.0
    end
  end
end

# ── HATS ─────────────────────────────────────────────────
live_loop :hihat_loop do
  amp = get(:kick_amp)
  density = get(:kick_density)
  sw = get(:kick_swing)
  bar = get(:phrase_bar)
  if amp < 0.05
    sleep 4
  else
    vel_pat = [1.0, 0.35, 0.6, 0.3, 0.9, 0.3, 0.55, 0.25,
               1.0, 0.3, 0.6, 0.35, 0.9, 0.25, 0.5, 0.35]
    thinned = bar >= 24 && bar < 28
    16.times do |i|
      d = get(:kick_density)
      a = get(:kick_amp)
      prob = thinned ? d * 0.3 : d * 0.8 + 0.1
      if rand < prob * vel_pat[i]
        bright = vel_pat[i] > 0.5 ? 0.1 : 0.05
        sample :drum_cymbal_closed,
          amp: a * 0.16 * vel_pat[i],
          rate: 1.1 + (vel_pat[i] * 0.3),
          finish: bright,
          pan: rrand(-0.15, 0.15)
      end
      if one_in(12) and d > 0.5 and !thinned
        sample :drum_cymbal_open,
          amp: a * 0.08, rate: 1.3, finish: 0.12, pan: rrand(-0.3, 0.3)
      end
      sl = i.odd? ? 0.25 + sw : 0.25 - sw
      sleep sl
    end
  end
end

# ── PERCUSSION ───────────────────────────────────────────
live_loop :perc_loop do
  amp = get(:kick_amp)
  density = get(:kick_density)
  bar = get(:phrase_bar)
  if amp < 0.05 or density < 0.3 or (bar >= 24 and bar < 28)
    sleep 2
  else
    8.times do
      d = get(:kick_density)
      a = get(:kick_amp)
      if rand < d * 0.4
        sample :drum_cymbal_closed, amp: a * 0.03,
          rate: rrand(2.5, 3.5), finish: 0.04, pan: rrand(0.2, 0.5)
      end
      if one_in(10) and d > 0.4
        sample :elec_blip, amp: a * 0.05,
          rate: rrand(1.0, 1.5), pan: rrand(-0.4, -0.1)
      end
      if one_in(14) and d > 0.6
        sample :perc_bell, amp: a * 0.04, rate: rrand(1.5, 2.5), pan: rrand(-0.5, 0.5)
      end
      sleep 0.25
    end
  end
end

# Polyrhythmic layer — 3 over 4
live_loop :poly_perc do
  amp = get(:kick_amp)
  density = get(:kick_density)
  if density < 0.45 or amp < 0.1
    sleep 2
  else
    3.times do
      if rand < density * 0.6
        sample :perc_bell, amp: amp * 0.05, rate: rrand(1.8, 2.8),
          pan: rrand(-0.4, 0.4)
      end
      sleep 2.0 / 3.0
    end
  end
end

# ── BASS (TB303 + Sub) ───────────────────────────────────
live_loop :bass_loop do
  amp = get(:bass_amp)
  cutoff = get(:bass_cutoff)
  tone = get(:bass_tone)
  tension = get(:bass_tension)
  density = get(:bass_density)
  bar = get(:phrase_bar)
  if amp < 0.05
    sleep 2
  else
    roots = tone == 1 ? MAJOR_ROOTS : MINOR_ROOTS
    root = roots.tick(:bass_root)
    res = sv(tension, 0, 1, 0.2, 0.8)
    use_synth :tb303
    if bar >= 24 and bar < 28
      # Breakdown — sustained sub only
      use_synth :sine
      play root - 12, amp: amp * 0.35, attack: 0.1, sustain: 1.5, release: 0.3
      sleep 2
    elsif density > 0.7
      # 8th note acid pattern
      pattern = [root, root, root+12, root, root+7, root, root+12, root]
      accents = [1.0, 0.4, 0.7, 0.3, 0.8, 0.35, 0.6, 0.4]
      8.times do |i|
        slide = rand < tension * 0.35
        play pattern[i], amp: amp * 0.4 * accents[i],
          release: slide ? 0.35 : 0.15,
          cutoff: [cutoff - 15 + (accents[i] * 20), 60].max,
          res: slide ? [res * 1.3, 0.95].min : res, wave: 0
        sleep 0.25
      end
    elsif density > 0.4
      # Syncopated pattern
      play root, amp: amp * 0.5, release: 0.3, cutoff: [cutoff, 85].min, res: res, wave: 1
      sleep 0.75
      play root + 12, amp: amp * 0.22, release: 0.15, cutoff: cutoff, res: res, wave: 0
      sleep 0.25
      sleep 0.5
      play root + 7, amp: amp * 0.3, release: 0.2, cutoff: [cutoff - 5, 60].max, res: res, wave: 0
      sleep 0.5
    else
      # Sustained with gentle filter sweep
      with_fx :lpf, cutoff: [cutoff, 85].min do
        play root, amp: amp * 0.5, attack: 0.05, sustain: 1.2, release: 0.6,
          cutoff: [cutoff, 80].min, res: res * 0.4, wave: 1
      end
      sleep 2
    end
  end
end

# Sub-bass layer — pure sine underneath
live_loop :sub_bass do
  amp = get(:bass_amp)
  tone = get(:bass_tone)
  bar = get(:phrase_bar)
  if amp < 0.1
    sleep 2
  else
    roots = tone == 1 ? MAJOR_ROOTS : MINOR_ROOTS
    root = roots.tick(:sub_root)
    use_synth :sine
    sub_amp = (bar >= 24 and bar < 28) ? amp * 0.4 : amp * 0.3
    play root - 12, amp: sub_amp, attack: 0.02, sustain: 1.4, release: 0.5
    sleep 2
  end
end

# ── PAD (inverse density — opens up when trading is quiet) ─
live_loop :pad_loop do
  amp = get(:pad_amp)
  reverb_val = get(:pad_reverb)
  tone = get(:pad_tone)
  cutoff = get(:pad_cutoff)
  tension = get(:pad_tension)
  density = get(:pad_density)
  bar = get(:phrase_bar)
  if amp < 0.05
    sleep 8
  else
    chords = tone == 1 ? MAJOR_CHORDS : MINOR_CHORDS
    c = chords.tick(:pad_chord)
    with_fx :reverb, room: [reverb_val, 0.92].min, mix: 0.55, damp: 0.4 do
      with_fx :hpf, cutoff: 55 do
        filt = cutoff + 15 - (tension * 20)
        with_fx :lpf, cutoff: [filt, 65].max do
          # Pad volume scales with its density param (which is INVERSE of trade rate)
          pad_vol = amp * sv(density, 0.3, 1.0, 0.1, 0.18)
          use_synth :hollow
          c.each_with_index do |n, i|
            play n, amp: pad_vol, attack: 1.5 + (i * 0.2),
              sustain: 5, release: 2.5, pan: (i - 1.5) * 0.25
          end
          use_synth :dsaw
          play c[0], amp: pad_vol * 0.4, attack: 2.0, sustain: 4,
            release: 3, detune: 0.12, cutoff: [cutoff + 5, 110].min, pan: -0.3
          play c[2] || c[1], amp: pad_vol * 0.4, attack: 2.0, sustain: 4,
            release: 3, detune: 0.08, cutoff: [cutoff + 5, 110].min, pan: 0.3
        end
      end
    end
    sleep 8
  end
end

# ── LEAD (threshold-gated — silent on quiet markets) ─────
live_loop :lead_loop do
  amp = get(:lead_amp)
  density = get(:lead_density)
  cutoff = get(:lead_cutoff)
  tone = get(:lead_tone)
  reverb_val = get(:lead_reverb)
  bar = get(:phrase_bar)
  if amp < 0.05
    sleep 1
  elsif bar >= 24 and bar < 28
    # Breakdown — sparse single notes with long tails
    use_synth :prophet
    notes = tone == 1 ? MAJOR_SCALE : MINOR_SCALE
    with_fx :reverb, room: 0.85, mix: 0.6 do
      with_fx :hpf, cutoff: 65 do
        if one_in(3)
          idx = get(:lead_note_idx) || 0
          idx = (idx + [-1, 1, 2].choose) % notes.size
          set :lead_note_idx, idx
          play notes[idx], amp: amp * 0.2, attack: 0.1,
            release: 2.5, cutoff: [cutoff - 10, 70].max, pan: rrand(-0.3, 0.3)
        end
      end
    end
    sleep 2
  else
    use_synth :prophet
    notes = tone == 1 ? MAJOR_SCALE : MINOR_SCALE
    num_notes = notes.size
    with_fx :reverb, room: [reverb_val * 0.7, 0.65].min, mix: 0.35 do
      with_fx :echo, phase: 0.375, decay: 1 + (reverb_val * 5), mix: 0.2 + (reverb_val * 0.15) do
        with_fx :hpf, cutoff: 65 do
          with_fx :lpf, cutoff: cutoff + 20 do
            phrase_len = density > 0.5 ? rrand_i(3, 6) : rrand_i(1, 3)
            phrase_len.times do
              if density > 0.35 or one_in(3)
                idx = get(:lead_note_idx) || 0
                movement = [-2, -1, -1, 0, 1, 1, 2].choose
                idx = (idx + movement) % num_notes
                set :lead_note_idx, idx
                play notes[idx], amp: amp * 0.25, attack: 0.02,
                  release: [0.4, 0.7, 1.0, 1.5].choose,
                  cutoff: cutoff + rrand_i(-5, 15), pan: rrand(-0.35, 0.35)
              end
              sleep density > 0.6 ? [0.25, 0.5, 0.5].choose : [0.5, 1.0, 0.75].choose
            end
            sleep density > 0.5 ? rrand(0.5, 1.5) : rrand(1.0, 3.0)
          end
        end
      end
    end
  end
end

# ── ATMOSPHERE (slow-reacting, smoothed params) ──────────
live_loop :atmos_loop do
  amp = get(:atmos_amp)
  reverb_val = get(:atmos_reverb)
  tone = get(:atmos_tone)
  density = get(:atmos_density)
  tension = get(:atmos_tension)
  if amp < 0.05
    sleep 8
  else
    root = tone == 1 ? :e2 : :d2
    notes = [root, root + 7, root + 12, root + 19]
    slicer_phase = density > 0.4 ? 0.25 : 0.5
    with_fx :reverb, room: 0.95, mix: 0.8, damp: 0.3 do
      with_fx :slicer, phase: slicer_phase, wave: 3, amp_min: 0.1, amp_max: 1.0, probability: 0.85 do
        with_fx :lpf, cutoff: 70 + (tension * 15) do
          use_synth :hollow
          play notes.choose, amp: amp * 0.1, attack: 3, sustain: 6, release: 4
          use_synth :sine
          play root - 12, amp: amp * 0.05, attack: 4, sustain: 5, release: 4
        end
      end
    end
    sleep 12
  end
end

# ── TEXTURE (sparse melodic detail) ─────────────────────
live_loop :texture_loop do
  amp = get(:pad_amp)
  density = get(:pad_density)
  tone = get(:pad_tone)
  cutoff = get(:pad_cutoff)
  bar = get(:phrase_bar)
  if amp < 0.05 or density < 0.3 or (bar >= 24 and bar < 28)
    sleep 4
  else
    notes = tone == 1 ? MAJOR_SCALE : MINOR_SCALE
    with_fx :reverb, room: 0.75, mix: 0.5 do
      with_fx :echo, phase: 0.375, decay: 4, mix: 0.25 do
        burst = rrand_i(2, 4)
        burst.times do
          if one_in(2)
            use_synth :blade
            play notes.choose + 12, amp: amp * 0.06, attack: 0.01,
              release: rrand(0.15, 0.4), cutoff: [cutoff + 10, 120].min,
              pan: rrand(-0.6, 0.6)
          end
          sleep [0.25, 0.375, 0.5].choose
        end
        sleep rrand(1.0, 3.0)
      end
    end
  end
end

# ── EVENT RESPONDER (market stingers) ────────────────────
live_loop :event_responder do
  spike = get(:event_spike)
  price_move = get(:event_price_move)
  tone = get(:kick_tone)
  if spike == 1
    set :event_spike, 0
    sample :drum_cymbal_open, amp: 0.2, rate: 1.0, finish: 0.25
    use_synth :prophet
    root = tone == 1 ? :e4 : :d4
    sc = tone == 1 ? :major_pentatonic : :minor_pentatonic
    with_fx :reverb, room: 0.7, mix: 0.4 do
      play scale(root, sc).choose + 12,
        amp: 0.22, attack: 0.01, release: 0.8, cutoff: 100
    end
  end
  if price_move != 0
    set :event_price_move, 0
    use_synth :blade
    sc = tone == 1 ? :major_pentatonic : :minor_pentatonic
    with_fx :reverb, room: 0.6, mix: 0.35 do
      with_fx :echo, phase: 0.25, decay: 2, mix: 0.25 do
        if price_move == 1
          [0, 4, 7, 12].each do |interval|
            play :e4 + interval, amp: 0.12, release: 0.3, cutoff: 105
            sleep 0.08
          end
        else
          [12, 7, 4, 0].each do |interval|
            play :e4 + interval, amp: 0.12, release: 0.3, cutoff: 80
            sleep 0.08
          end
        end
      end
    end
  end
  sleep 0.5
end

# ── RESOLUTION FANFARE ───────────────────────────────────
live_loop :resolution_check do
  resolved = get(:market_resolved)
  if resolved != 0
    use_synth :prophet
    if resolved == 1
      with_fx :reverb, room: 0.85, mix: 0.5 do
        with_fx :echo, phase: 0.25, decay: 3, mix: 0.2 do
          [:e4, :b4, :e5, :g5, :b5].each_with_index do |n, i|
            play n, amp: 0.3, release: 2.0 - (i * 0.3), pan: (i - 2) * 0.2
            sleep 0.15
          end
          play :e6, amp: 0.25, release: 4.0
        end
      end
    else
      with_fx :reverb, room: 0.9, mix: 0.6 do
        [:b4, :g4, :e4, :d4, :b3, :e3].each_with_index do |n, i|
          play n, amp: 0.3, release: 1.2, cutoff: 90 - (i * 8)
          sleep 0.2
        end
      end
    end
    set :market_resolved, 0
    sleep 4
  else
    sleep 1
  end
end

live_loop :ambient_check do
  if get(:ambient_mode) == 1
    with_fx :reverb, room: 0.98, mix: 0.85 do
      with_fx :echo, phase: 1.5, decay: 6, mix: 0.3 do
        use_synth :hollow
        play scale(:e2, :minor).choose, amp: 0.06, attack: 6, release: 12
        use_synth :sine
        play scale(:e5, :minor).choose, amp: 0.025, attack: 4,
          release: 8, pan: rrand(-0.5, 0.5)
      end
    end
    sleep 16
  else
    sleep 4
  end
end
