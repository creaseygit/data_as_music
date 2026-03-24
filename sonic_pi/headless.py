"""
Sonic Pi Headless Launcher

Boots Sonic Pi's daemon (scsynth + Spider server) without the GUI,
sends keep-alive pings, and provides an API to run .rb code and
send OSC messages.

Usage:
    launcher = SonicPiHeadless()
    await launcher.boot()
    await launcher.run_code(open("bar_track.rb").read())
    # ... later ...
    await launcher.shutdown()
"""
import asyncio
import atexit
import socket
import subprocess
import sys
import os
import threading
from pathlib import Path
from pythonosc import udp_client
from pythonosc.osc_message import OscMessage

# Track all spawned processes so we can clean up on crash/exit
_spawned_processes = []

def _cleanup_on_exit():
    """Kill any Sonic Pi processes we spawned, even on unclean exit."""
    for proc in _spawned_processes:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    _spawned_processes.clear()

atexit.register(_cleanup_on_exit)
from pythonosc.osc_message_builder import OscMessageBuilder


# ── Locate Sonic Pi installation ──────────────────────────

def find_sonic_pi():
    """Find Sonic Pi install directory."""
    candidates = [
        Path("C:/Program Files/Sonic Pi"),
        Path("C:/Program Files (x86)/Sonic Pi"),
        Path(os.environ.get("SONIC_PI_HOME", "")),
    ]
    for p in candidates:
        if (p / "app" / "server" / "ruby" / "bin" / "daemon.rb").exists():
            return p
    raise FileNotFoundError(
        "Sonic Pi not found. Install it or set SONIC_PI_HOME env var."
    )


class SonicPiHeadless:
    def __init__(self):
        self.sonic_pi_dir = find_sonic_pi()
        self.ruby_exe = self.sonic_pi_dir / "app" / "server" / "native" / "ruby" / "bin" / "ruby.exe"
        self.daemon_rb = self.sonic_pi_dir / "app" / "server" / "ruby" / "bin" / "daemon.rb"

        # Ports (populated after boot)
        self.daemon_port = None
        self.gui_listen_port = None
        self.gui_send_port = None
        self.scsynth_port = None
        self.osc_cues_port = None
        self.tau_api_port = None
        self.tau_phx_port = None
        self.token = None

        # Clients
        self._daemon_client = None
        self._spider_client = None
        self._process = None
        self._keepalive_task = None

    async def boot(self, timeout=30):
        """Boot the Sonic Pi daemon and wait for it to be ready."""
        print("[SONIC PI] Booting headless...", flush=True)
        print(f"[SONIC PI] Ruby: {self.ruby_exe}", flush=True)
        print(f"[SONIC PI] Daemon: {self.daemon_rb}", flush=True)

        env = os.environ.copy()
        # Sonic Pi needs to find its native libs
        native_dir = str(self.sonic_pi_dir / "app" / "server" / "native")
        env["PATH"] = native_dir + ";" + env.get("PATH", "")

        self._process = subprocess.Popen(
            [str(self.ruby_exe), str(self.daemon_rb)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=str(self.sonic_pi_dir / "app" / "server" / "ruby"),
        )
        _spawned_processes.append(self._process)

        # Read port allocations from stdout
        # Format: daemon gui-listen gui-send scsynth osc-cues tau-api tau-phx token
        print("[SONIC PI] Waiting for daemon to allocate ports...", flush=True)

        ports_line = await asyncio.wait_for(
            self._read_ports_line(),
            timeout=timeout
        )

        parts = ports_line.strip().split()
        if len(parts) < 8:
            raise RuntimeError(f"Unexpected daemon output: {ports_line}")

        self.daemon_port = int(parts[0])
        self.gui_listen_port = int(parts[1])
        self.gui_send_port = int(parts[2])
        self.scsynth_port = int(parts[3])
        self.osc_cues_port = int(parts[4])
        self.tau_api_port = int(parts[5])
        self.tau_phx_port = int(parts[6])
        self.token = int(parts[7])

        print(f"[SONIC PI] Daemon port:     {self.daemon_port}", flush=True)
        print(f"[SONIC PI] Spider send:     {self.gui_send_port}", flush=True)
        print(f"[SONIC PI] Spider listen:   {self.gui_listen_port}", flush=True)
        print(f"[SONIC PI] Scsynth port:    {self.scsynth_port}", flush=True)
        print(f"[SONIC PI] OSC cues port:   {self.osc_cues_port}", flush=True)
        print(f"[SONIC PI] Token:           {self.token}", flush=True)

        # Create OSC clients
        self._daemon_client = udp_client.SimpleUDPClient("127.0.0.1", self.daemon_port)
        self._spider_client = udp_client.SimpleUDPClient("127.0.0.1", self.gui_send_port)

        # Listen for errors from Spider on gui_listen_port
        self._start_error_listener()

        # Start keep-alive loop
        self._keepalive_task = asyncio.create_task(self._keepalive_loop())

        # Give Spider server a moment to fully initialize
        await asyncio.sleep(3)
        print("[SONIC PI] Ready.", flush=True)

    async def _read_ports_line(self):
        """Read the ports line from daemon stdout in a thread."""
        loop = asyncio.get_event_loop()

        def _read():
            # The daemon prints port info to stdout
            # It may print multiple lines — we want the one with 8 space-separated numbers
            while True:
                line = self._process.stdout.readline().decode("utf-8", errors="replace").strip()
                if not line:
                    # Check if process died
                    if self._process.poll() is not None:
                        stderr = self._process.stderr.read().decode("utf-8", errors="replace")
                        raise RuntimeError(f"Daemon exited early. stderr: {stderr[:500]}")
                    continue
                print(f"[SONIC PI] stdout: {line}", flush=True)
                # Check if this looks like the ports line (8 numbers)
                parts = line.split()
                if len(parts) >= 8:
                    try:
                        [int(p) for p in parts[:8]]
                        return line
                    except ValueError:
                        pass

        return await loop.run_in_executor(None, _read)

    def _start_error_listener(self):
        """Listen on gui_listen_port for error messages from Spider."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", self.gui_listen_port))

        def _listen():
            while True:
                try:
                    data, _ = sock.recvfrom(16384)
                    try:
                        msg = OscMessage(data)
                        addr = msg.address
                        if "error" in addr or "syntax" in addr:
                            print(f"[SONIC PI ERROR] {addr}: {msg.params}", flush=True)
                        elif addr == "/log/multi_message":
                            # Spider sends log messages here too
                            pass
                        elif addr not in ("/incoming/osc", "/log/info"):
                            print(f"[SONIC PI MSG] {addr}", flush=True)
                    except Exception:
                        pass
                except Exception:
                    break

        t = threading.Thread(target=_listen, daemon=True)
        t.start()

    async def _keepalive_loop(self):
        """Send keep-alive pings to the daemon every 2 seconds."""
        while True:
            try:
                self._daemon_client.send_message("/daemon/keep-alive", self.token)
            except Exception:
                pass
            await asyncio.sleep(2)

    async def run_code(self, code: str):
        """Send Ruby code to the Spider server for execution."""
        if not self._spider_client or self.token is None:
            raise RuntimeError("Sonic Pi not booted yet")

        print(f"[SONIC PI] Running code ({len(code)} chars)...", flush=True)

        msg = OscMessageBuilder(address="/run-code")
        msg.add_arg(self.token, arg_type="i")
        msg.add_arg(code, arg_type="s")
        built = msg.build()
        self._spider_client._sock.sendto(
            built.dgram,
            (self._spider_client._address, self._spider_client._port)
        )

    async def run_file(self, filepath: str):
        """Load and run an .rb file."""
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Track not found: {filepath}")
        code = path.read_text(encoding="utf-8")
        # Strip comment-only lines and blank lines to stay within
        # Sonic Pi's 16384-byte UDP receive buffer
        lines = code.split('\n')
        stripped = [l for l in lines if l.strip() and not l.strip().startswith('#')]
        compact = '\n'.join(stripped)
        print(f"[SONIC PI] Track {path.name}: {len(code)}→{len(compact)} bytes (stripped comments)", flush=True)
        await self.run_code(compact)

    async def stop_code(self):
        """Stop all running code."""
        if self._spider_client and self.token is not None:
            msg = OscMessageBuilder(address="/stop-all-jobs")
            msg.add_arg(self.token, arg_type="i")
            built = msg.build()
            self._spider_client._sock.sendto(
                built.dgram,
                (self._spider_client._address, self._spider_client._port)
            )

    async def shutdown(self):
        """Shut down the Sonic Pi daemon."""
        print("[SONIC PI] Shutting down...", flush=True)
        if self._keepalive_task:
            self._keepalive_task.cancel()
        if self._daemon_client and self.token is not None:
            try:
                msg = OscMessageBuilder(address="/daemon/exit")
                msg.add_arg(self.token, arg_type="i")
                built = msg.build()
                self._daemon_client._sock.sendto(
                    built.dgram,
                    (self._daemon_client._address, self._daemon_client._port)
                )
            except Exception:
                pass
        if self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
        print("[SONIC PI] Stopped.", flush=True)

    @property
    def is_running(self):
        return self._process is not None and self._process.poll() is None
