set_volume! 0.7

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

use_bpm 120

define :pool_chords do
  t = get(:tone)
  if t == 1
    [chord(:d4, :major7), chord(:b3, :minor7), chord(:g3, :major7), chord(:a3, :dom7)]
  else
    [chord(:d4, :minor7), chord(:b3, :dim7), chord(:g3, :minor7), chord(:a3, :minor7)]
  end
end

define :bass_roots do
  t = get(:tone)
  t == 1 ? [:d2, :b1, :g1, :a1] : [:d2, :b1, :g1, :a1]
end

live_loop :kick do
  h = get(:heat)
  amp_val = 0.2 + (h * 0.4)
  sample :bd_haus, amp: amp_val * 0.88, cutoff: 90  # ~nf
  sleep 1
end

live_loop :hats do
  h = get(:heat)
  tr = get(:trade_rate)
  amp_val = 0.06 + (tr * 0.12)
  sleep 0.5
  sample :drum_cymbal_open, amp: amp_val * 0.73, rate: 2.2, finish: 0.06  # ~nf
  sleep 0.5
end

live_loop :shaker do
  tr = get(:trade_rate)
  if tr > 0.2
    amp_val = 0.03 + (tr * 0.06)
    4.times do
      sample :drum_cymbal_closed, amp: amp_val * (0.5 + rand(0.5)) * 2.48,  # ~nf
        rate: 2.5 + rand(0.5), finish: 0.04
      sleep 0.25
    end
  else
    sleep 1
  end
end

live_loop :clap do
  sleep 1
  h = get(:heat)
  sample :sn_dub, amp: (0.08 + (h * 0.15)) * 0.78, rate: 1.3, cutoff: 100  # ~nf
  sleep 1
end

live_loop :piano_chords, sync: :kick do
  h = get(:heat)
  pr = get(:price)
  chords = pool_chords
  amp_val = 0.08 + (h * 0.18)
  cut = 80 + (pr * 30)
  use_synth :piano
  chords.each do |c|
    sleep 0.75
    synth :piano, note: c, amp: amp_val * 0.97, hard: 0.3 + (h * 0.2),  # ~nf
      vel: 0.4 + (pr * 0.3), pan: 0.1
    sleep 0.25
    if rand < (0.3 + h * 0.4)
      synth :piano, note: c, amp: amp_val * 0.5 * 0.97, hard: 0.2,  # ~nf
        vel: 0.3, pan: -0.1
    end
    sleep 0.5
    synth :piano, note: c, amp: amp_val * 0.7 * 0.97, hard: 0.25,  # ~nf
      vel: 0.35 + (pr * 0.2), pan: 0.05
    sleep 0.5
  end
end

live_loop :bass, sync: :kick do
  h = get(:heat)
  sp = get(:spread)
  roots = bass_roots
  amp_val = 0.18 + (h * 0.25)
  cut = 70 + (get(:price) * 40)
  use_synth :tb303
  roots.each do |r|
    play r, amp: amp_val * 0.6, release: 0.25, cutoff: cut, res: 0.2, wave: 0  # ~nf
    sleep 0.5
    play r + 12, amp: amp_val * 0.7 * 0.6, release: 0.15, cutoff: cut - 10, res: 0.2, wave: 0  # ~nf
    sleep 0.25
    if h > 0.5 && rand < 0.4
      play r + 7, amp: amp_val * 0.4 * 0.6, release: 0.1, cutoff: cut - 15, res: 0.3, wave: 0  # ~nf
    end
    sleep 0.25
    play r, amp: amp_val * 0.5 * 0.6, release: 0.2, cutoff: cut - 5, res: 0.2, wave: 0  # ~nf
    sleep 0.5
    play r + 12, amp: amp_val * 0.6 * 0.6, release: 0.15, cutoff: cut - 10, res: 0.2, wave: 0  # ~nf
    sleep 0.5
  end
end

live_loop :pad do
  h = get(:heat)
  pr = get(:price)
  chords = pool_chords
  amp_val = [0.12 - (h * 0.06), 0.03].max
  use_synth :hollow
  with_fx :lpf, cutoff: 75 + (pr * 25) do
    with_fx :reverb, room: 0.8, mix: 0.5 do
      chords.each do |c|
        play c, amp: amp_val * 2.66, attack: 1.0, release: 2.5, pan: rrand(-0.2, 0.2)  # ~nf
        sleep 4
      end
    end
  end
end

live_loop :stab do
  h = get(:heat)
  v = get(:velocity)
  if h > 0.4
    chords = pool_chords
    idx = (tick % 4)
    c = chords[idx]
    amp_val = 0.04 + (v * 0.08)
    use_synth :saw
    with_fx :reverb, room: 0.4, mix: 0.3 do
      with_fx :lpf, cutoff: 85 + (h * 20) do
        play c.map { |n| n + 12 }, amp: amp_val * 0.6, release: 0.1  # ~nf
        sleep 0.5
        play c.map { |n| n + 12 }, amp: amp_val * 0.6 * 0.6, release: 0.08  # ~nf
        sleep 0.5
      end
    end
    sleep 3
  else
    sleep 4
  end
end

live_loop :sub do
  roots = bass_roots
  h = get(:heat)
  use_synth :sine
  roots.each do |r|
    play r - 12, amp: (0.15 + (h * 0.1)) * 0.23, attack: 0.1, release: 3.5  # ~nf
    sleep 4
  end
end

live_loop :ride do
  tr = get(:trade_rate)
  h = get(:heat)
  if h > 0.55
    amp_val = 0.03 + (tr * 0.05)
    sample :drum_cymbal_open, amp: amp_val * 0.73, rate: 1.8, finish: 0.12  # ~nf
  end
  sleep 0.5
end

live_loop :perc do
  h = get(:heat)
  tr = get(:trade_rate)
  if tr > 0.35
    amp_val = 0.04 + (h * 0.06)
    sample :drum_tom_lo_hard, amp: amp_val * 0.67, rate: 1.4, finish: 0.15  # ~nf
    sleep 0.75
    sample :drum_tom_lo_hard, amp: amp_val * 0.5 * 0.67, rate: 1.6, finish: 0.1  # ~nf
    sleep 0.25
    sleep 1
  else
    sleep 2
  end
end

live_loop :events do
  sleep 0.5
  if get(:event_spike) == 1
    set :event_spike, 0
    sample :drum_cymbal_hard, amp: 0.2 * 1.1, rate: 0.9  # ~nf
    chords = pool_chords
    use_synth :piano
    c = chords[0]
    with_fx :reverb, room: 0.7 do
      synth :piano, note: c, amp: 0.2 * 0.97, hard: 0.5, vel: 0.7  # ~nf
    end
  end
  pm = get(:event_price_move)
  if pm != 0
    set :event_price_move, 0
    t = get(:tone)
    root = t == 1 ? :d4 : :d4
    sc = t == 1 ? :major : :minor
    ns = scale(root, sc, num_octaves: 2)
    notes = pm > 0 ? ns.take(6) : ns.take(6).reverse
    use_synth :piano
    with_fx :reverb, room: 0.6, damp: 0.4 do
      notes.each_with_index do |n, i|
        frac = i.to_f / (notes.length - 1)
        amp_env = pm > 0 ? 0.14 * (0.6 + frac * 0.4) : 0.14 * (1.0 - frac * 0.3)
        synth :piano, note: n, amp: amp_env * 0.97, hard: 0.35, vel: 0.5,  # ~nf
          pan: (frac - 0.5) * 0.3
        sleep 0.2
      end
    end
  end
end

live_loop :resolved do
  mr = get(:market_resolved)
  if mr != 0
    set :market_resolved, 0
    use_synth :piano
    if mr == 1
      ns = scale(:d4, :major, num_octaves: 2).take(8)
      with_fx :reverb, room: 0.85, damp: 0.3 do
        ns.each_with_index do |n, i|
          frac = i.to_f / (ns.length - 1)
          synth :piano, note: n, amp: 0.18 * (0.5 + frac * 0.5) * 0.97,  # ~nf
            hard: 0.3 + (frac * 0.3), vel: 0.5 + (frac * 0.3),
            pan: (frac - 0.5) * 0.4
          sleep 0.25
        end
      end
    else
      ns = scale(:d4, :minor, num_octaves: 1).reverse
      with_fx :reverb, room: 0.85, damp: 0.6 do
        ns.each_with_index do |n, i|
          frac = i.to_f / (ns.length - 1)
          synth :piano, note: n, amp: 0.15 * (1.0 - frac * 0.3) * 0.97,  # ~nf
            hard: 0.35, vel: 0.5, pan: (0.5 - frac) * 0.4
          sleep 0.3
        end
      end
    end
  end
  sleep 0.5
end

live_loop :ambient do
  if get(:ambient_mode) == 1
    use_synth :hollow
    with_fx :reverb, room: 0.9, mix: 0.8 do
      play [:d3, :fs3, :a3].choose, amp: 0.12 * 2.66, attack: 3, release: 5  # ~nf
    end
  end
  sleep 6
end
