# Data as Music

**The Polymarket DJ** — a web app that turns prediction market activity into generative music in real time.

Live at [dam.fm](https://dam.fm)

## How It Works

A Python server connects to Polymarket's APIs, scores markets by real-time activity (price velocity, trade rate, volume, spread), normalizes the data to 0–1 ranges, and pushes it to connected browsers via WebSocket. The browser runs [Strudel](https://strudel.cc) (a TidalCycles-inspired live coding engine) to turn that data stream into music — each track is a self-contained `.js` file that maps market signals to musical patterns.

```
Polymarket APIs → Python scorer → WebSocket → Browser (Strudel audio)
```

Every listener gets their own sensitivity curve, so the same market can sound different depending on how you tune it.

## Tracks

| Track | Style |
| ----- | ----- |
| Late Night in Bb | 8-voice jazz trio |
| Digging in the Markets | 8-voice lo-fi hip hop with swung drums and Rhodes |
| Weather Vane | Single-voice vibraphone price-direction alert (silent when the market is still) |

Drop a new `.js` file in `frontend/tracks/` and restart — no other changes needed.

## Running Locally

```bash
# macOS
source venv/bin/activate
python server.py

# Windows
.\venv\Scripts\activate
python server.py
```

Open [http://localhost:8888](http://localhost:8888), pick a market from the browse tabs or paste a market URL, and audio starts automatically.

## Sandbox

Visit `/sandbox` to test tracks with simulated market data — sliders, presets, sweeps, and per-voice gain mixing without needing a live market connection.

## Tech Stack

- **Server:** Python 3.12 / asyncio / aiohttp
- **Market data:** Polymarket Gamma REST API + CLOB WebSocket feed
- **Audio:** Strudel 1.3.0 (browser-based, custom esbuild bundle with `@strudel/web` + `@strudel/soundfonts`)
- **Infra:** AWS Lightsail + Nginx + CloudFlare

## License

[AGPL-3.0](LICENSE)
