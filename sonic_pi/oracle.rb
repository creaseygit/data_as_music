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

live_loop :price_watch do
  p = get(:price)
  t = get(:tone)
  delta = p - prev_price
  mag = delta.abs
  prev_price = p
  if mag > 0.02
    root = t == 1 ? :c4 : :a3
    sc = t == 1 ? :major : :minor
    num = mag > 0.04 ? 4 : 2 + (mag * 50).to_i
    num = [[num, 2].max, 5].min
    ns = scale(root, sc, num_octaves: 2)
    if delta > 0
      notes = ns.take(num)
    else
      notes = ns.take(num).reverse
    end
    vol = [[0.08 + (mag * 1.5), 0.08].max, 0.18].min
    hard = [[0.25 + (mag * 2), 0.25].max, 0.55].min
    with_fx :reverb, room: 0.6, damp: 0.5 do
      notes.each_with_index do |n, i|
        frac = i.to_f / [notes.length - 1, 1].max
        amp_env = delta > 0 ? vol * (0.7 + frac * 0.3) : vol * (1.0 - frac * 0.3)
        synth :piano, note: n, amp: amp_env * 0.97, hard: hard,  # ~nf
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
    ns = scale(root, sc, num_octaves: 2)
    if pm == 1
      notes = ns.take(7)
    else
      notes = ns.take(7).reverse
    end
    with_fx :reverb, room: 0.7, damp: 0.4 do
      notes.each_with_index do |n, i|
        frac = i.to_f / (notes.length - 1)
        amp_env = pm == 1 ? 0.16 * (0.6 + frac * 0.4) : 0.16 * (1.0 - frac * 0.3)
        synth :piano, note: n, amp: amp_env * 0.97,  # ~nf
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
      notes = scale(:c4, :major, num_octaves: 1)
      with_fx :reverb, room: 0.9, damp: 0.3 do
        notes.each_with_index do |n, i|
          frac = i.to_f / (notes.length - 1)
          synth :piano, note: n, amp: 0.18 * (0.5 + frac * 0.5) * 0.97,  # ~nf
            hard: 0.3 + (frac * 0.3), vel: 0.5 + (frac * 0.3),
            pan: (frac - 0.5) * 0.4
          sleep 0.3
        end
      end
    else
      notes = scale(:a4, :minor, num_octaves: 1).reverse
      with_fx :reverb, room: 0.9, damp: 0.6 do
        notes.each_with_index do |n, i|
          frac = i.to_f / (notes.length - 1)
          synth :piano, note: n, amp: 0.15 * (1.0 - frac * 0.3) * 0.97,  # ~nf
            hard: 0.4 - (frac * 0.1), vel: 0.6 - (frac * 0.2),
            pan: (0.5 - frac) * 0.4
          sleep 0.3
        end
      end
    end
  end
  sleep 0.5
end
