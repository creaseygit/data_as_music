# Sonic Pi Integration

## Headless Launcher

The headless launcher (`sonic_pi/headless.py`):

1. Finds Ruby + daemon.rb in Sonic Pi install dir
2. Runs `daemon.rb` which spawns `scsynth` + Spider server + Tau
3. Reads port allocations from daemon stdout (8 values: daemon, gui-listen, gui-send, scsynth, osc-cues, tau-api, tau-phx, token)
4. Sends `/daemon/keep-alive` with token every 2s
5. Sends `/run-code [token, code]` to Spider to execute .rb code
6. Listens on `gui_listen_port` for `/error` and `/syntax_error` messages from Spider (printed to console as `[SONIC PI ERROR]`)

## Critical Details

**Data push mechanism:** Data is pushed via `run_code` (e.g., `set :heat, 0.65`) NOT just OSC messages. Tracks read values with `get(:heat)` in their loops. OSC `sync` listeners exist but are unreliable for parameter updates.

**16KB OSC limit:** Sonic Pi's Spider server uses `recvfrom(16384)` — track `.rb` files must produce OSC packets under 16KB. The `run_file` method strips comment-only lines and blank lines before sending to stay within this limit. Keep tracks concise; avoid verbose comments in `.rb` files.

**Orphan cleanup:** Previous headless instances can leave `scsynth.exe` and `ruby.exe` running. The Stop button and Kill All button both run `taskkill /F` on these processes. The `atexit` handler in `headless.py` also cleans up.

**Track hot-reload:** Tracks are re-discovered from disk on every Start and Track Switch, so new/edited/deleted `.rb` files are picked up without restarting the server.

**Error visibility:** Spider errors are captured via a UDP listener on `gui_listen_port` and printed to the server console as `[SONIC PI ERROR]`. Without this, errors are silently swallowed in headless mode. Noisy messages (`/incoming/osc`, `/log/info`) are filtered out.

**Audio device:** scsynth outputs to Windows default audio device.
