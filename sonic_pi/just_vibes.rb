# @category music
# @label Just Vibes

set :heat, 0.3
set :price, 0.5
set :velocity, 0.1
set :trade_rate, 0.2
set :spread, 0.2
set :tone, 1
set :event_spike, 0
set :event_price_move, 0
set :market_resolved, 0
set :ambient_mode, 0

set_volume! 0.7
use_bpm 75

prev_price = 0.5
last_delta = 0.0

define :lofi_roots do
  t = get(:tone)
  t == 1 ? [:f2, :e2, :d2, :c2] : [:d2, :bb1, :g1, :a1]
end

define :lofi_chords do
  t = get(:tone)
  if t == 1
    [chord(:f3, :major7), chord(:e3, :minor7),
     chord(:d3, :minor7), chord(:c3, :major7)]
  else
    [chord(:d3, :minor7), chord(:bb2, :major7),
     chord(:g2, :minor7), chord(:a2, :minor7)]
  end
end

live_loop :chord_clock do
  set :chord_idx, tick(:ci) % 4
  sleep 4
end

live_loop :vinyl do
  sample :vinyl_hiss, amp: 0.05 * 5.0, rate: 0.7  # ~nf
  sleep 8
end

live_loop :kick do
  h = get(:heat)
  tr = get(:trade_rate)
  amp_val = 0.18 + (h * 0.1)
  sample :bd_fat, amp: amp_val * 1.59, cutoff: 60, rate: 0.8  # ~nf
  if tr > 0.4 && rand < 0.25
    sleep 1.5
    sample :bd_fat, amp: amp_val * 0.25 * 1.59, cutoff: 50, rate: 0.75  # ~nf
    sleep 0.5
  else
    sleep 2
  end
  sample :bd_fat, amp: amp_val * 0.9 * 1.59, cutoff: 60, rate: 0.8  # ~nf
  sleep 2
end

live_loop :snare do
  sleep 2
  h = get(:heat)
  with_fx :reverb, room: 0.85, damp: 0.6, mix: 0.55 do
    sample :sn_dub, amp: (0.06 + (h * 0.04)) * 0.77, rate: 0.85, finish: 0.25  # ~nf
  end
  if rand < 0.15
    sleep 1.75
    with_fx :reverb, room: 0.9, damp: 0.5, mix: 0.65 do
      sample :sn_dub, amp: 0.025 * 0.77, rate: 0.9, finish: 0.15  # ~nf
    end
    sleep 0.25
  else
    sleep 2
  end
end

live_loop :hats do
  tr = get(:trade_rate)
  prob = 0.12 + (tr * 0.35)
  if rand < prob
    with_fx :hpf, cutoff: 105 do
      sample :drum_cymbal_closed, amp: rrand(0.015, 0.04) * 2.2,  # ~nf
        rate: rrand(1.3, 1.7), finish: 0.04, pan: rrand(-0.3, 0.3)
    end
  end
  sleep tr > 0.5 ? 0.25 : 0.5
end

live_loop :rim do
  tr = get(:trade_rate)
  if tr > 0.2
    pat = (ring 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0)
    if pat.tick == 1
      sample :drum_cowbell, amp: 0.02 * 0.52, rate: 2.8,  # ~nf
        finish: 0.03, pan: rrand(-0.15, 0.15)
    end
  end
  sleep 0.25
end

live_loop :sub_bass do
  h = get(:heat)
  roots = lofi_roots
  idx = get(:chord_idx)
  r = roots[idx]
  use_synth :sine
  amp_val = 0.14 + (h * 0.06)
  with_fx :lpf, cutoff: 50 do
    play r, amp: amp_val * 0.23 * 0.39, attack: 0.15, sustain: 3, release: 0.8  # ~nf
  end
  sleep 4
end

live_loop :bass_line do
  h = get(:heat)
  pr = get(:price)
  roots = lofi_roots
  idx = get(:chord_idx)
  r = roots[idx]
  rn = note(r)
  use_synth :tb303
  cut = 42 + (pr * 18)
  amp_val = 0.05 + (h * 0.03)
  phrases = [
    [rn, 1.5, :r, 0.5, rn+7, 0.5, :r, 0.5, rn, 0.5],
    [:r, 0.5, rn, 1.0, rn+5, 0.5, :r, 0.5, rn, 1.5],
    [rn, 1.0, :r, 0.5, rn+7, 0.5, rn+5, 0.5, :r, 0.5, rn, 0.5, :r, 0.5],
    [rn, 0.5, :r, 1.0, rn+3, 0.5, rn, 1.0, :r, 1.0]
  ]
  phrase = phrases[rand_i(phrases.length)]
  steps = phrase.each_slice(2).to_a
  with_fx :lpf, cutoff: cut + 10 do
    steps.each do |n, dur|
      if n != :r
        play n, amp: amp_val * rrand(0.8, 1.0) * 0.6 * 0.59,  # ~nf
          release: [dur * 0.6, 0.3].min, cutoff: cut, res: 0.12, wave: 0
      end
      sleep dur
    end
  end
end

live_loop :pad_wash do
  h = get(:heat)
  pr = get(:price)
  chords = lofi_chords
  idx = get(:chord_idx)
  ch = chords[idx]
  use_synth :hollow
  amp_val = [0.045 - (h * 0.02), 0.012].max
  with_fx :reverb, room: 0.92, damp: 0.65, mix: 0.7 do
    with_fx :lpf, cutoff: 58 + (pr * 18) do
      play ch, amp: amp_val * 2.66 * 2.15, attack: 2.5, release: 5,  # ~nf
        pan: rrand(-0.2, 0.2)
    end
  end
  sleep [6, 8].choose
end

live_loop :deep_echo do
  v = get(:velocity)
  if v > 0.25
    roots = lofi_roots
    r = roots.choose
    rn = note(r)
    use_synth :dark_ambience
    with_fx :echo, phase: 1.0, decay: 8, mix: 0.5 do
      with_fx :lpf, cutoff: 65 do
        play rn + 24, amp: (0.025 + (v * 0.025)) * 5.0 * 5.0,  # ~nf
          attack: 1.5, release: 4
      end
    end
  end
  sleep [10, 12, 14].choose
end

live_loop :price_drift do
  p_now = get(:price)
  raw_delta = p_now - prev_price
  mag = raw_delta.abs
  prev_price = p_now
  last_delta = raw_delta
  if mag > 0.02
    t = get(:tone)
    sc = t == 1 ? scale(:f4, :major_pentatonic, num_octaves: 2) :
      scale(:d4, :minor_pentatonic, num_octaves: 2)
    num = [[2 + (mag * 15).to_i, 2].max, 5].min
    vol = [[0.04 + (mag * 0.5), 0.04].max, 0.11].min
    ns = raw_delta > 0 ? sc.take(num) : sc.take(num).reverse
    use_synth :piano
    with_fx :reverb, room: 0.9, damp: 0.4, mix: 0.75 do
      with_fx :lpf, cutoff: 82 do
        ns.each do |n|
          vl = vol * rrand(0.6, 1.0)
          synth :piano, note: n, amp: vl * 0.97 * 0.95, hard: 0.12,  # ~nf
            vel: 0.25 + rrand(0.0, 0.1), pan: rrand(-0.2, 0.2)
          sleep [0.5, 0.75, 1.0].choose
        end
      end
    end
  end
  sleep 3
end

live_loop :event_move do
  pm = get(:event_price_move)
  if pm != 0
    set :event_price_move, 0
    t = get(:tone)
    sc = t == 1 ? scale(:f4, :major, num_octaves: 2) :
      scale(:d4, :minor, num_octaves: 2)
    ns = pm > 0 ? sc.take(7) : sc.take(7).reverse
    use_synth :piano
    with_fx :reverb, room: 0.92, damp: 0.35, mix: 0.8 do
      with_fx :echo, phase: 0.75, decay: 6, mix: 0.45 do
        with_fx :lpf, cutoff: 85 do
          ns.each_with_index do |n, i|
            frac = i.to_f / [ns.length - 1, 1].max
            amp_env = pm > 0 ? 0.09 * (0.5 + frac * 0.3) :
              0.09 * (0.9 - frac * 0.3)
            synth :piano, note: n, amp: amp_env * 0.97 * 0.95,  # ~nf
              hard: 0.12, vel: 0.3 + rrand(0.0, 0.12),
              pan: (frac - 0.5) * 0.3
            sleep [0.4, 0.5, 0.6].choose
          end
        end
      end
    end
  end
  sleep 0.5
end

spike_cooldown = 15
spike_last_at = Time.now - spike_cooldown

live_loop :event_spike_fx do
  if get(:event_spike) == 1
    set :event_spike, 0
    now = Time.now
    if now - spike_last_at >= spike_cooldown
      spike_last_at = now
      with_fx :reverb, room: 0.85, damp: 0.4, mix: 0.65 do
        sample :drum_cymbal_soft, amp: 0.06 * 1.87, rate: 0.45  # ~nf
      end
    end
  end
  sleep 0.5
end

live_loop :resolved do
  mr = get(:market_resolved)
  if mr != 0
    set :market_resolved, 0
    use_synth :piano
    if mr == 1
      ns = scale(:f4, :major, num_octaves: 1)
    else
      ns = scale(:d4, :minor, num_octaves: 1).reverse
    end
    with_fx :reverb, room: 0.95, damp: 0.3, mix: 0.8 do
      with_fx :echo, phase: 0.5, decay: 6, mix: 0.4 do
        ns.each_with_index do |n, i|
          frac = i.to_f / [ns.length - 1, 1].max
          synth :piano, note: n, amp: 0.09 * (0.5 + frac * 0.5) * 0.97 * 0.95,  # ~nf
            hard: 0.12 + (frac * 0.12), vel: 0.3,
            pan: (frac - 0.5) * 0.3
          sleep 0.5
        end
      end
    end
  end
  sleep 0.5
end

live_loop :ambient_drone do
  if get(:ambient_mode) == 1
    use_synth :dark_ambience
    with_fx :reverb, room: 0.95, mix: 0.85 do
      with_fx :lpf, cutoff: 58 do
        play [:f2, :c3, :f3].choose, amp: 0.06 * 5.0 * 5.0,  # ~nf
          attack: 4, release: 8
      end
    end
  end
  sleep 8
end
