import json
import pathlib
from pythonosc import udp_client
from config import OSC_IP, OSC_PORT
from polymarket.scorer import MarketScorer

# Instrument slot → Sonic Pi OSC address prefix
SLOT_OSC_MAP = {
    "kick":        "/btc/kick",
    "bass":        "/btc/bass",
    "pad":         "/btc/pad",
    "lead":        "/btc/lead",
    "atmosphere":  "/btc/atmos",
}


class OSCBridge:
    def __init__(self, scorer: MarketScorer):
        self.client  = udp_client.SimpleUDPClient(OSC_IP, OSC_PORT)
        self.scorer  = scorer

    def push_market_params(self, slot: str, asset_id: str):
        """
        Derive musical parameters from a market's live state
        and send them to Sonic Pi via OSC.
        """
        if slot not in SLOT_OSC_MAP:
            return

        prefix = SLOT_OSC_MAP[slot]
        heat   = self.scorer.heat(asset_id)
        vel    = self.scorer.price_velocity(asset_id)
        rate   = self.scorer.trade_rate(asset_id)
        bid, ask = self.scorer.spreads[asset_id]
        price  = list(self.scorer.price_history[asset_id])
        last_price = price[-1][1] if price else 0.5

        # ── Musical mappings ──────────────────────────────

        # Overall energy of this layer (capped at 0.8 to prevent clipping)
        amp     = _scale(heat, 0, 1, 0.1, 0.8)
        # Filter brightness — overbought markets sound bright
        cutoff  = _scale(last_price, 0, 1, 60, 115)
        # Reverb room — volatile markets sound spacious
        reverb  = _scale(vel, 0, 1, 0.1, 0.85)
        # Note density — trade rate drives rhythmic density
        density = _scale(rate, 0, 1, 0.1, 1.0)
        # Tonality — above 0.5 probability = major, below = minor
        tone    = 1 if last_price >= 0.5 else 0
        # Spread drives dissonance — wide spread = tense harmony
        tension = _scale(ask - bid, 0, 0.3, 0.0, 1.0)

        self.client.send_message(f"{prefix}/amp",     amp)
        self.client.send_message(f"{prefix}/cutoff",  cutoff)
        self.client.send_message(f"{prefix}/reverb",  reverb)
        self.client.send_message(f"{prefix}/density", density)
        self.client.send_message(f"{prefix}/tone",    tone)
        self.client.send_message(f"{prefix}/tension", tension)

    def send_layer_command(self, slot: str, asset_id: str | None, command: str):
        """Send a transition command to Sonic Pi."""
        prefix = SLOT_OSC_MAP.get(slot, "/btc/unknown")
        self.client.send_message(f"{prefix}/command", command)
        if asset_id:
            self.push_market_params(slot, asset_id)

    def send_global(self, key: str, value):
        """Send a global event — market resolution, ambient mode etc."""
        self.client.send_message(f"/btc/global/{key}", value)

    def write_now_playing(self, layers: dict):
        """Write current playing state to JSON for OBS overlay."""
        state = {
            slot: {
                "question": layer["question"][:55],
                "heat": round(self.scorer.heat(layer["asset_id"]), 2)
            }
            for slot, layer in layers.items()
        }
        pathlib.Path("now_playing.json").write_text(json.dumps(state))


def _scale(val, in_lo, in_hi, out_lo, out_hi):
    n = max(0.0, min(1.0, (val - in_lo) / max(in_hi - in_lo, 0.0001)))
    return out_lo + n * (out_hi - out_lo)
