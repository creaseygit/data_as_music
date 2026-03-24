# midnight_ticker — dark electronic track driven by raw market data
#
# Data interface (pushed by Python every 3s, all 0-1 unless noted):
#   get(:heat)       — composite market activity
#   get(:price)      — current price (WS midpoint)
#   get(:velocity)   — price velocity
#   get(:trade_rate) — trades/min
#   get(:spread)     — bid-ask spread
#   get(:tone)       — 1=major, 0=minor (with hysteresis)
#   get(:event_spike)      — 1 on heat spike (one-shot)
#   get(:event_price_move) — +1 up, -1 down (one-shot)
#   get(:market_resolved)  — 1/-1 when market resolves
#   get(:ambient_mode)     — 1 when no markets active

set_volume! 0.7

# Defaults so track plays immediately
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

# -- helpers --
define :maj_scale do |root|
  scale(root, :major_pentatonic)
end

define :min_scale do |root|
  scale(root, :minor_pentatonic)
end

define :pick_root do
  get(:tone) == 1 ? :e2 : :d2
end

define :pick_scale do |oct_shift|
  r = note(pick_root) + (12 * oct_shift)
  get(:tone) == 1 ? scale(r, :major_pentatonic) : scale(r, :minor_pentatonic)
end

# ── KICK ──
live_loop :kick do
  h = get(:heat)
  amp_val = 0.15 + (h * 0.55)
  sample :bd_haus, amp: amp_val, cutoff: 80
  # Double-hit on high activity
  if h > 0.7 && spread(3,8).look
    sleep 0.25
    sample :bd_haus, amp: amp_val * 0.6, cutoff: 70
    sleep 0.75
  else
    sleep 1
  end
end

# ── HATS ──
live_loop :hats do
  tr = get(:trade_rate)
  h = get(:heat)
  # Faster hats when market is active
  div = tr > 0.6 ? 0.125 : 0.25
  amp_val = 0.05 + (h * 0.15)
  if rand < (0.3 + tr * 0.5)
    sample :drum_cymbal_closed, amp: amp_val, rate: 1.5 + rand(0.5), finish: 0.08
  end
  sleep div
end

# ── SNARE ──
live_loop :snare do
  sleep 1
  h = get(:heat)
  sample :sn_dub, amp: 0.1 + (h * 0.25), cutoff: 90 + (h * 20), rate: 1.1
  sleep 1
end

# ── BASS ──
live_loop :bass do
  h = get(:heat)
  sp = get(:spread)
  r = pick_root
  # TB303 style — resonance from spread (tight spread = clean, wide = gritty)
  res_val = 0.7 + (sp * 0.25)
  cut = 60 + (get(:price) * 50)
  amp_val = 0.15 + (h * 0.35)
  use_synth :tb303
  # Pattern complexity from trade rate
  tr = get(:trade_rate)
  notes = tr > 0.5 ? [r, r+12, r+7, r+12] : [r, r, r+12, r]
  notes.each do |n|
    play n, amp: amp_val, release: 0.2, cutoff: cut, res: res_val, wave: 1
    sleep 0.25
  end
end

# ── SUB ──
live_loop :sub do
  r = pick_root
  h = get(:heat)
  use_synth :sine
  play r - 12, amp: 0.2 + (h * 0.15), release: 1.8, attack: 0.1
  sleep 2
end

# ── PAD ──
live_loop :pad do
  h = get(:heat)
  pr = get(:price)
  sp = get(:spread)
  # Pad is louder when market is calm — fills the space
  amp_val = [0.5 - (h * 0.3), 0.08].max
  sc = pick_scale(2)
  use_synth :hollow
  notes = get(:tone) == 1 ? chord(sc[0], :major7) : chord(sc[0], :minor7)
  with_fx :reverb, room: 0.7 + (get(:velocity) * 0.25), mix: 0.6 do
    with_fx :lpf, cutoff: 70 + (pr * 30) do
      play notes, amp: amp_val, attack: 1.5, release: 4, pan: rrand(-0.3, 0.3)
    end
  end
  sleep 4
end

# ── LEAD ──
live_loop :lead do
  tr = get(:trade_rate)
  h = get(:heat)
  # Only play when market has enough activity
  if tr < 0.3
    sleep 2
  else
    sc = pick_scale(3)
    amp_val = 0.05 + (h * 0.15)
    cut = 75 + (get(:price) * 35)
    use_synth :saw
    with_fx :reverb, room: 0.5, mix: 0.4 do
      with_fx :echo, phase: 0.375, decay: 3, mix: 0.3 do
        # Phrase length from trade rate
        phrase_len = tr > 0.7 ? 4 : 2
        phrase_len.times do
          n = sc.choose
          play n, amp: amp_val, release: 0.15, cutoff: cut
          sleep [0.25, 0.5].choose
        end
      end
    end
    sleep 0.5
  end
end

# ── TEXTURE ──
live_loop :texture do
  v = get(:velocity)
  h = get(:heat)
  if v > 0.2
    sc = pick_scale(4)
    use_synth :blade
    with_fx :reverb, room: 0.85, mix: 0.7 do
      play sc.choose, amp: 0.03 + (v * 0.06), attack: 0.5, release: 2, cutoff: 90
    end
  end
  sleep [3, 4, 5].choose
end

# ── EVENTS ──
live_loop :events do
  sleep 0.5
  # Heat spike — crash + stab
  if get(:event_spike) == 1
    set :event_spike, 0
    sample :drum_cymbal_hard, amp: 0.25, rate: 0.8
    sc = pick_scale(3)
    use_synth :zpad
    play chord(sc[0], :minor7), amp: 0.15, release: 1.5, cutoff: 95
  end
  # Price move — arpeggio
  pm = get(:event_price_move)
  if pm != 0
    set :event_price_move, 0
    sc = pick_scale(3)
    use_synth :saw
    notes = pm > 0 ? sc.take(5) : sc.take(5).reverse
    with_fx :echo, phase: 0.25, decay: 2, mix: 0.4 do
      notes.each do |n|
        play n, amp: 0.08, release: 0.1, cutoff: 100
        sleep 0.1
      end
    end
  end
end

# ── AMBIENT FALLBACK ──
live_loop :ambient do
  if get(:ambient_mode) == 1
    use_synth :hollow
    with_fx :reverb, room: 0.9, mix: 0.8 do
      play [:e3, :b3, :e4].choose, amp: 0.15, attack: 3, release: 5
    end
  end
  sleep 6
end
