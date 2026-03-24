from pythonosc import udp_client
from config import OSC_IP, OSC_PORT
from polymarket.scorer import MarketScorer


class OSCBridge:
    def __init__(self, scorer: MarketScorer):
        self.client = udp_client.SimpleUDPClient(OSC_IP, OSC_PORT)
        self.scorer = scorer

    def send_global(self, key: str, value):
        """Send a global event — market resolution, ambient mode etc."""
        self.client.send_message(f"/btc/global/{key}", value)


def _scale(val, in_lo, in_hi, out_lo, out_hi):
    n = max(0.0, min(1.0, (val - in_lo) / max(in_hi - in_lo, 0.0001)))
    return out_lo + n * (out_hi - out_lo)
