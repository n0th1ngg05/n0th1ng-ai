from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import threading
import urllib.request
import urllib.error
from pathlib import Path


ROOT = Path(__file__).resolve().parent

SOURCE = ROOT / "source"

PYTHON = (
    ROOT / ".venv" / "Scripts" / "python.exe"
    if os.name == "nt"
    else ROOT / ".venv" / "bin" / "python"
)

API_SERVER = SOURCE / "server" / "api_server.py"

MODELS = ROOT / "models"

ENGINE_HOST = "127.0.0.1"
ENGINE_PORT = 6102

DEFAULT_RUNTIME_URL = "http://127.0.0.1:9000"

HEALTH_TIMEOUT_SECONDS = 300


def _wait_for_health(url: str, timeout: float) -> bool:
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
    payload = json.dumps({"provider_id": provider_id, "port": port}).encode()
    req = urllib.request.Request(
        f"{runtime_url}/register",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
            print(f"[chatterbox/launcher] Registered with runtime: {body.get('status')}", flush=True)
            return True
    except Exception as exc:
        print(f"[chatterbox/launcher] WARNING: Could not register with runtime: {exc}", flush=True)
        return False


def _heartbeat_loop(runtime_url: str, provider_id: str, interval: int = 25) -> None:
    payload = json.dumps({"provider_id": provider_id}).encode()

    def _beat():
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
                    if body.get("status") == "unknown":
                        print("[chatterbox/launcher] Runtime doesn't know us — re-registering", flush=True)
                        _post_register(runtime_url, provider_id, ENGINE_PORT)
            except Exception:
                pass

    t = threading.Thread(target=_beat, daemon=True, name="chatterbox-heartbeat")
    t.start()


def main():

    if not PYTHON.exists():
        raise FileNotFoundError(PYTHON)

    if not API_SERVER.exists():
        raise FileNotFoundError(API_SERVER)

    runtime_url = os.environ.get("SPEECH_RUNTIME_URL", DEFAULT_RUNTIME_URL).rstrip("/")

    env = os.environ.copy()

    pythonpath = env.get("PYTHONPATH", "")

    env["PYTHONPATH"] = (
        str(SOURCE)
        if not pythonpath
        else str(SOURCE) + os.pathsep + pythonpath
    )

    command = [
        str(PYTHON),
        str(API_SERVER),

        "--device",
        "cuda",

        "--listen",
        f"{ENGINE_HOST}:{ENGINE_PORT}",

        "--workers",
        "1",

        "--model-path",
        str(MODELS),
    ]

    process = subprocess.Popen(
        command,
        cwd=str(SOURCE),
        env=env,
    )

    print(
        f"[chatterbox/launcher] Engine started (PID {process.pid}) — "
        f"waiting for /v1/health on {ENGINE_HOST}:{ENGINE_PORT} …",
        flush=True,
    )

    health_url = f"http://{ENGINE_HOST}:{ENGINE_PORT}/v1/health"

    if _wait_for_health(health_url, HEALTH_TIMEOUT_SECONDS):
        print("[chatterbox/launcher] Engine is healthy — registering with runtime", flush=True)
        registered = _post_register(runtime_url, "chatterbox", ENGINE_PORT)
        if registered:
            _heartbeat_loop(runtime_url, "chatterbox")
    else:
        print(
            f"[chatterbox/launcher] WARNING: Engine did not become healthy within "
            f"{HEALTH_TIMEOUT_SECONDS}s — skipping registration.",
            flush=True,
        )

    exit_code = process.wait()
    sys.exit(exit_code)


if __name__ == "__main__":
    main()