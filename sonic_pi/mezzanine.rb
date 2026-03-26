# @category music
# @label Mezzanine

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
use_bpm 80

prev_price = 0.5
last_delta = 0.0

# Teardrop-inspired: Am -> G -> F -> Am
# tone=1 (bullish): brighter Am voicings
# tone=0 (bearish): darker, chromatic G# tension

define :chord_root do
  # 4-bar progression cycling Am(A) -> Am(A) -> F -> G
  idx = tick(:chord_idx) % 8
  case idx
  when 0, 1 then :a2
  when 2, 3 then :a2
  when 4, 5 then :f2
  when 6, 7 then :g2
  end
end

define :arp_notes do
  t = get(:tone)
  idx = look(:chord_idx) % 8
  case idx
  when 0..3
    t == 1 ? [:a4, :c5, :e5, :c5, :a4, :c5] :
      [:a4, :c5, :e5, :c5, :gs4, :c5]
  when 4, 5
    [:f4, :a4, :c5, :a4, :f4, :a4]
  else
    [:g4, :b4, :d5, :b4, :g4, :b4]
  end
end

live_loop :sub_bass do
  h = get(:heat)
  r = chord_root
  use_synth :sine
  amp_val = 0.16 + (h * 0.1)
  with_fx :lpf, cutoff: 55 do
    play r, amp: amp_val * 0.23, attack: 0.2, sustain: 3, release: 0.8  # ~nf
  end
  sleep 4
end

live_loop :bass_line do
  h = get(:heat)
  pr = get(:price)
  t = get(:tone)
  use_synth :tb303
  cut = 48 + (pr * 25)
  amp_val = 0.06 + (h * 0.05)
  idx = look(:chord_idx) % 8
  r = note(look(:chord_idx) % 8 < 4 ? :a2 : (look(:chord_idx) % 8 < 6 ? :f2 : :g2))
  phrases = [
    [r,   1.5, :r, 0.5, r+7, 0.5, r+5, 0.5, r, 1.0],
    [:r,  0.5, r,  1.0, r+3, 0.5, r+5, 1.0, :r, 1.0],
    [r,   1.0, r+5, 0.5, r+3, 0.5, :r,  0.5, r+7, 0.5, r, 0.5, :r, 0.5],
    [r+7, 0.5, r+5, 0.5, :r,  1.0, r,   1.0, r+3, 1.0]
  ]
  phrase = phrases.tick(:bass_phrase)
  steps = phrase.each_slice(2).to_a
  with_fx :lpf, cutoff: cut do
    steps.each do |n, dur|
      if n != :r
        play n, amp: amp_val * rrand(0.8, 1.0) * 0.6, release: [dur * 0.7, 0.35].min,  # ~nf
          cutoff: cut, res: 0.2, wave: 0
      end
      sleep dur
    end
  end
end

live_loop :teardrop_arp do
  h = get(:heat)
  pr = get(:price)
  v = get(:velocity)
  tr = get(:trade_rate)
  ns = arp_notes
  use_synth :pluck
  amp_val = [0.04 - (h * 0.015), 0.015].max
  if h > 0.75 && rand < 0.6
    sleep 4
  else
    with_fx :reverb, room: 0.8, damp: 0.5, mix: 0.6 do
      with_fx :lpf, cutoff: 75 + (pr * 15) do
        sleep 0.5
        ns.each do |n|
          if rand < 0.12
            sleep [0.25, 0.5].choose
          else
            oct = (v > 0.4 && rand < v * 0.4) ? 12 : 0
            vel = amp_val * rrand(0.6, 1.0)
            play n + oct, amp: vel * 1.86, release: rrand(1.0, 2.0), coeff: rrand(0.1, 0.2)  # ~nf
            if tr > 0.5 && rand < 0.2
              sleep 0.25
              play n + 12, amp: vel * 0.5 * 1.86, release: 0.8, coeff: 0.1  # ~nf
              sleep 0.25
            else
              sleep tr > 0.4 ? [0.25, 0.5, 0.75].choose : 0.5
            end
          end
        end
        sleep 0.5
      end
    end
  end
end

live_loop :kick do
  h = get(:heat)
  tr = get(:trade_rate)
  amp_val = 0.2 + (h * 0.15)
  sample :bd_fat, amp: amp_val * 1.6, cutoff: 70, rate: 0.85  # ~nf
  if tr > 0.4
    sleep 0.75
    sample :bd_fat, amp: amp_val * 0.4 * 1.6, cutoff: 60, rate: 0.8  # ~nf
    sleep 1.25
  else
    sleep 2
  end
end

live_loop :kick_ghost do
  tr = get(:trade_rate)
  h = get(:heat)
  pat = (ring 0, 0, 1, 0, 0, 1, 0, 0)
  if tr > 0.3 && pat.tick == 1
    sample :bd_fat, amp: (0.06 + (h * 0.05)) * 1.6, cutoff: 55, rate: 0.75  # ~nf
  end
  sleep 0.5
end

live_loop :snare_dub do
  sleep 2
  h = get(:heat)
  tr = get(:trade_rate)
  with_fx :reverb, room: 0.8, damp: 0.6, mix: 0.5 do
    sample :sn_dub, amp: (0.08 + (h * 0.07)) * 0.78, rate: 0.9, finish: 0.3  # ~nf
  end
  if tr > 0.5 && rand < 0.4
    sleep 1.5
    with_fx :reverb, room: 0.9, damp: 0.5, mix: 0.6 do
      sample :sn_dub, amp: 0.05 * 0.78, rate: 1.0, finish: 0.2  # ~nf
    end
    sleep 0.5
  else
    sleep 2
  end
end

live_loop :rim do
  tr = get(:trade_rate)
  h = get(:heat)
  if tr > 0.25
    pat = (ring 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0)
    if pat.tick == 1
      sample :drum_cowbell, amp: (0.03 + (h * 0.03)) * 0.52, rate: 2.5,  # ~nf
        finish: 0.04, pan: rrand(-0.2, 0.2)
    end
  end
  sleep 0.25
end

live_loop :hat_ghost do
  tr = get(:trade_rate)
  prob = 0.1 + tr * 0.35
  if rand < prob
    with_fx :hpf, cutoff: 110 do
      sample :drum_cymbal_closed, amp: rrand(0.02, 0.06) * 2.48,  # ~nf
        rate: rrand(1.2, 1.8), finish: 0.05, pan: rrand(-0.4, 0.4)
    end
  end
  div = tr > 0.6 ? 0.25 : 0.5
  sleep div
end

live_loop :vinyl_dust do
  sample :vinyl_hiss, amp: 0.045 * 5.0, rate: 0.8  # ~nf
  sleep 8
end

live_loop :dub_wash do
  h = get(:heat)
  pr = get(:price)
  t = get(:tone)
  use_synth :hollow
  ch = t == 1 ? chord(:a3, :minor7) : chord(:a3, :m7minus5)
  amp_val = [0.05 - (h * 0.025), 0.015].max
  with_fx :reverb, room: 0.95, damp: 0.7, mix: 0.75 do
    with_fx :lpf, cutoff: 55 + (pr * 20) do
      play ch.choose, amp: amp_val * 2.66, attack: 3, release: 5, pan: rrand(-0.3, 0.3)  # ~nf
    end
  end
  sleep [6, 8].choose
end

live_loop :deep_echo do
  v = get(:velocity)
  if v > 0.3
    t = get(:tone)
    ns = t == 1 ? [:a3, :c4, :e4] : [:a3, :c4, :gs3]
    use_synth :dark_ambience
    with_fx :echo, phase: 0.75, decay: 6, mix: 0.6 do
      with_fx :lpf, cutoff: 70 do
        play ns.choose, amp: (0.03 + (v * 0.03)) * 5.0, attack: 1, release: 3  # ~nf
      end
    end
  end
  sleep [8, 10, 12].choose
end

live_loop :price_drift do
  p = get(:price)
  raw_delta = p - prev_price
  mag = raw_delta.abs
  prev_price = p
  last_delta = raw_delta
  if mag > 0.05
    t = get(:tone)
    sc = t == 1 ? scale(:a4, :minor_pentatonic, num_octaves: 2) :
      scale(:a4, :minor_pentatonic, num_octaves: 2)
    num = [[2 + (mag * 20).to_i, 2].max, 6].min
    vol = [[0.04 + (mag * 0.6), 0.04].max, 0.14].min
    ns = raw_delta > 0 ? sc.take(num) : sc.take(num).reverse
    use_synth :pluck
    with_fx :reverb, room: 0.9, damp: 0.4, mix: 0.75 do
      with_fx :echo, phase: 0.5, decay: 5, mix: 0.5 do
        with_fx :lpf, cutoff: 85 do
          ns.each do |n|
            v = vol * rrand(0.6, 1.0)
            play n, amp: v * 1.86, release: 3, coeff: 0.2  # ~nf
            sleep [0.5, 0.75, 1.0].choose
          end
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
    mag = last_delta.abs
    t = get(:tone)
    sc = scale(:a4, :minor, num_octaves: 2)
    num = [[3 + (mag * 30).to_i, 3].max, 7].min
    vol = [[0.04 + (mag * 0.6), 0.04].max, 0.1].min
    ns = pm > 0 ? sc.take(num) : sc.take(num).reverse
    use_synth :piano
    with_fx :reverb, room: 0.92, damp: 0.35, mix: 0.8 do
      with_fx :echo, phase: 0.75, decay: 6, mix: 0.5 do
        with_fx :lpf, cutoff: 90 do
          ns.each_with_index do |n, i|
            frac = i.to_f / [ns.length - 1, 1].max
            amp_env = vol * (0.5 + frac * 0.3) * rrand(0.7, 1.0)
            play n, amp: amp_env * 0.97, hard: 0.15, vel: 0.3 + rrand(0.0, 0.15),  # ~nf
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
      with_fx :reverb, room: 0.8, damp: 0.4, mix: 0.6 do
        sample :drum_cymbal_soft, amp: 0.08 * 1.88, rate: 0.5  # ~nf
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
      ns = scale(:a4, :major, num_octaves: 1)
    else
      ns = scale(:a4, :minor, num_octaves: 1).reverse
    end
    with_fx :reverb, room: 0.95, damp: 0.3, mix: 0.8 do
      with_fx :echo, phase: 0.5, decay: 6, mix: 0.4 do
        ns.each_with_index do |n, i|
          frac = i.to_f / [ns.length - 1, 1].max
          play n, amp: 0.1 * (0.5 + frac * 0.5) * 0.97,  # ~nf
            hard: 0.15 + (frac * 0.15), vel: 0.35, pan: (frac - 0.5) * 0.3
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
      with_fx :lpf, cutoff: 60 do
        play [:a2, :e3, :a3].choose, amp: 0.08 * 5.0, attack: 4, release: 8  # ~nf
      end
    end
  end
  sleep 8
end
