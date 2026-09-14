from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"

PYTHON = (
    ROOT / ".venv" / "Scripts" / "python.exe"
    if os.name == "nt"
    else ROOT / ".venv" / "bin" / "python"
)

API_SERVER = SOURCE / "tools" / "api_server.py"

MODEL_ROOT = ROOT / "models" / "fishspeech-1.5"

DECODER = (
    MODEL_ROOT /
    "firefly-gan-vq-fsq-8x1024-21hz-generator.pth"
)

# Port this engine listens on (must match runtime/config.py EngineConfig.ports).
ENGINE_PORT = 6101
ENGINE_HOST = "127.0.0.1"

# Runtime URL to self-register with once the engine is ready.
# Can be overridden via the SPEECH_RUNTIME_URL environment variable.
DEFAULT_RUNTIME_URL = "http://127.0.0.1:9000"

# How long to wait for /v1/health before giving up and not registering.
HEALTH_TIMEOUT_SECONDS = 300  # 5 min — model load can be slow on first run


def _wait_for_health(url: str, timeout: float) -> bool:
    """Poll *url* until it returns HTTP 200 or *timeout* expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1.0)
    return False


def _post_register(runtime_url: str, provider_id: str, port: int) -> bool:
    """Call POST /register on the runtime.  Returns True on success."""
    payload = json.dumps(
        {"provider_id": provider_id, "port": port}
    ).encode()

    req = urllib.request.Request(
        f"{runtime_url}/register",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
            status = body.get("status", "")
            print(
                f"[fishspeech/launcher] Registered with runtime: {status}",
                flush=True,
            )
            return True
    except Exception as exc:
        print(
            f"[fishspeech/launcher] WARNING: Could not register with runtime: {exc}",
            flush=True,
        )
        return False


def _heartbeat_loop(runtime_url: str, provider_id: str, interval: int = 25) -> None:
    """Send periodic heartbeats to the runtime (runs in a daemon thread)."""
    import threading

    def _beat():
        payload = json.dumps({"provider_id": provider_id}).encode()
        while True:
            time.sleep(interval)
            req = urllib.request.Request(
                f"{runtime_url}/heartbeat",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    body = json.loads(resp.read())
                    # If runtime says 'unknown', it restarted — re-register.
                    if body.get("status") == "unknown":
                        print(
                            "[fishspeech/launcher] Runtime doesn't know us — re-registering",
                            flush=True,
                        )
                        _post_register(runtime_url, provider_id, ENGINE_PORT)
            except Exception:
                pass  # heartbeat failure is non-fatal; watchdog will evict us if needed

    t = threading.Thread(target=_beat, daemon=True, name="fishspeech-heartbeat")
    t.start()


def main():

    if not PYTHON.exists():
        raise FileNotFoundError(
            f"Python not found:\n{PYTHON}"
        )

    if not API_SERVER.exists():
        raise FileNotFoundError(
            f"api_server.py not found:\n{API_SERVER}"
        )

    if not MODEL_ROOT.exists():
        raise FileNotFoundError(
            f"Model folder not found:\n{MODEL_ROOT}"
        )

    runtime_url = os.environ.get("SPEECH_RUNTIME_URL", DEFAULT_RUNTIME_URL).rstrip("/")

    env = os.environ.copy()

    python_path = env.get("PYTHONPATH", "")

    env["PYTHONPATH"] = (
        str(SOURCE)
        if not python_path
        else str(SOURCE) + os.pathsep + python_path
    )
    env["PYTORCH_SDP_ATTENTION_BACKEND"] = "math"

    command = [
        str(PYTHON),
        str(API_SERVER),

        "--mode",
        "tts",

        "--device",
        "cuda",

        "--listen",
        f"{ENGINE_HOST}:{ENGINE_PORT}",

        "--workers",
        "1",

        "--llama-checkpoint-path",
        str(MODEL_ROOT),

        "--decoder-checkpoint-path",
        str(DECODER),

        "--decoder-config-name",
        "firefly_gan_vq",
    ]

    # Launch the engine server in the background so we can poll its health.
    process = subprocess.Popen(
        command,
        cwd=str(SOURCE),
        env=env,
    )

    print(
        f"[fishspeech/launcher] Engine started (PID {process.pid}) — "
        f"waiting for /v1/health on {ENGINE_HOST}:{ENGINE_PORT} …",
        flush=True,
    )

    health_url = f"http://{ENGINE_HOST}:{ENGINE_PORT}/v1/health"

    if _wait_for_health(health_url, HEALTH_TIMEOUT_SECONDS):
        print("[fishspeech/launcher] Engine is healthy — registering with runtime", flush=True)
        registered = _post_register(runtime_url, "fishspeech", ENGINE_PORT)
        if registered:
            # Start the heartbeat daemon so the runtime knows we're still alive.
            _heartbeat_loop(runtime_url, "fishspeech")
    else:
        print(
            f"[fishspeech/launcher] WARNING: Engine did not become healthy within "
            f"{HEALTH_TIMEOUT_SECONDS}s — skipping registration.",
            flush=True,
        )

    # Block until the engine subprocess exits.
    exit_code = process.wait()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()