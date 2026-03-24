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

set_volume! 0.8
prev_price = 0.5
motif_idx = 0

rise_motifs = [
  [0, 2, 4],
  [0, 2, 4, 7],
  [0, 4, 7, 11],
  [4, 2, 4, 7],
  [0, 4, 2, 4, 7]
]

fall_motifs = [
  [7, 4, 2],
  [7, 4, 2, 0],
  [11, 7, 4, 0],
  [4, 7, 4, 2],
  [7, 4, 7, 2, 0]
]

live_loop :price_watch do
  p = get(:price)
  t = get(:tone)
  delta = p - prev_price
  mag = delta.abs
  prev_price = p
  if mag > 0.02
    root = t == 1 ? :c4 : :a3
    sc = t == 1 ? :major : :minor
    all_notes = scale(root, sc, num_octaves: 2)
    octave_shift = ((p - 0.5) * 6).to_i
    if delta > 0
      motif = mag > 0.04 ? rise_motifs[motif_idx % 5] : rise_motifs[motif_idx % 3]
    else
      motif = mag > 0.04 ? fall_motifs[motif_idx % 5] : fall_motifs[motif_idx % 3]
    end
    motif_idx = motif_idx + 1
    vol = [[0.08 + (mag * 1.2), 0.08].max, 0.18].min
    hard = [[0.25 + (mag * 2), 0.25].max, 0.55].min
    with_fx :reverb, room: 0.6, damp: 0.5 do
      motif.each_with_index do |deg, i|
        frac = i.to_f / [motif.length - 1, 1].max
        n = all_notes[deg + octave_shift] || all_notes[deg]
        amp_env = delta > 0 ? vol * (0.7 + frac * 0.3) : vol * (1.0 - frac * 0.3)
        synth :piano, note: n, amp: amp_env, hard: hard,
          vel: 0.5 + (mag * 2), pan: (frac - 0.5) * 0.3
        sleep 0.3
      end
    end
  end
  sleep 3
end

live_loop :price_event do
  pm = get(:event_price_move)
  t = get(:tone)
  if pm != 0
    set :event_price_move, 0
    root = t == 1 ? :c4 : :a3
    sc = t == 1 ? :major : :minor
    all_notes = scale(root, sc, num_octaves: 2)
    if pm == 1
      motif = [0, 4, 7, 4, 7, 11]
    else
      motif = [11, 7, 4, 7, 4, 0]
    end
    vol = 0.16
    with_fx :reverb, room: 0.7, damp: 0.4 do
      motif.each_with_index do |deg, i|
        frac = i.to_f / (motif.length - 1)
        n = all_notes[deg] || all_notes[0]
        amp_env = pm == 1 ? vol * (0.6 + frac * 0.4) : vol * (1.0 - frac * 0.3)
        synth :piano, note: n, amp: amp_env,
          hard: 0.4, vel: 0.6, pan: (frac - 0.5) * 0.4
        sleep 0.3
      end
    end
  end
  sleep 0.25
end

live_loop :resolved do
  mr = get(:market_resolved)
  if mr != 0
    set :market_resolved, 0
    if mr == 1
      all_notes = scale(:c4, :major, num_octaves: 2)
      motif = [0, 2, 4, 7, 4, 7, 11]
      with_fx :reverb, room: 0.9, damp: 0.3 do
        motif.each_with_index do |deg, i|
          frac = i.to_f / (motif.length - 1)
          synth :piano, note: all_notes[deg], amp: 0.18 * (0.5 + frac * 0.5),
            hard: 0.3 + (frac * 0.3), vel: 0.5 + (frac * 0.3),
            pan: (frac - 0.5) * 0.4
          sleep 0.35
        end
      end
    else
      all_notes = scale(:a3, :minor, num_octaves: 2)
      motif = [11, 7, 4, 7, 4, 2, 0]
      with_fx :reverb, room: 0.9, damp: 0.6 do
        motif.each_with_index do |deg, i|
          frac = i.to_f / (motif.length - 1)
          synth :piano, note: all_notes[deg], amp: 0.15 * (1.0 - frac * 0.3),
            hard: 0.4 - (frac * 0.1), vel: 0.6 - (frac * 0.2),
            pan: (0.5 - frac) * 0.4
          sleep 0.35
        end
      end
    end
  end
  sleep 0.5
end
