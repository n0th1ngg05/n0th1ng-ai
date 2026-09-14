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

from loguru import logger

logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
           "<level>{level: <8}</level> | "
           "<magenta>kokoro/launcher</magenta> - "
           "<level>{message}</level>",
    level="INFO",
    colorize=True,
)


ROOT = Path(__file__).resolve().parent

SOURCE = ROOT / "source"

PYTHON = (
    ROOT / ".venv" / "Scripts" / "python.exe"
    if os.name == "nt"
    else ROOT / ".venv" / "bin" / "python"
)

API_SERVER = SOURCE / "api_server.py"

ENGINE_HOST = "127.0.0.1"
ENGINE_PORT = 6103

DEFAULT_RUNTIME_URL = "http://127.0.0.1:9000"

HEALTH_TIMEOUT_SECONDS = 300


def _wait_for_health(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    start = time.monotonic()
    last_log = 0.0
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        elapsed = time.monotonic() - start
        # Re-print a waiting message every ~10s so a long model load
        # (first-run HuggingFace download, cold CUDA init, etc.) doesn't
        # look like the launcher has hung.
        if elapsed - last_log >= 10:
            logger.info("Still waiting for engine health ({:.0f}s elapsed)...", elapsed)
            last_log = elapsed
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
            logger.info("Registered with runtime: {}", body.get("status"))
            return True
    except Exception as exc:
        logger.warning("Could not register with runtime: {}", exc)
        return False


def _heartbeat_loop(runtime_url: str, provider_id: str, interval: int = 25) -> None:
    payload = json.dumps({"provider_id": provider_id}).encode()
    beat_count = 0

    def _beat():
        nonlocal beat_count
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
                    beat_count += 1
                    if body.get("status") == "unknown":
                        logger.warning("Runtime doesn't know us — re-registering")
                        _post_register(runtime_url, provider_id, ENGINE_PORT)
                    else:
                        logger.debug("Heartbeat #{} ok", beat_count)
            except Exception as exc:
                logger.debug("Heartbeat failed (will retry): {}", exc)

    t = threading.Thread(target=_beat, daemon=True, name="kokoro-heartbeat")
    t.start()


def main():

    if not PYTHON.exists():
        raise FileNotFoundError(PYTHON)

    if not API_SERVER.exists():
        raise FileNotFoundError(API_SERVER)

    logger.info("=" * 50)
    logger.info("  KOKORO ENGINE LAUNCHER")
    logger.info("=" * 50)
    logger.info("Python  : {}", PYTHON)
    logger.info("Server  : {}", API_SERVER)
    logger.info("Port    : {}", ENGINE_PORT)

    runtime_url = os.environ.get("SPEECH_RUNTIME_URL", DEFAULT_RUNTIME_URL).rstrip("/")
    logger.info("Runtime : {}", runtime_url)
    logger.info("=" * 50)

    launch_start = time.monotonic()

    env = os.environ.copy()

    command = [
        str(PYTHON),
        str(API_SERVER),
        "--device",
        "cuda",
        "--host",
        ENGINE_HOST,
        "--port",
        str(ENGINE_PORT),
    ]

    process = subprocess.Popen(
        command,
        cwd=str(SOURCE),
        env=env,
    )

    logger.info(
        "Engine started (PID {}) — waiting for /v1/health on {}:{} …",
        process.pid, ENGINE_HOST, ENGINE_PORT,
    )

    health_url = f"http://{ENGINE_HOST}:{ENGINE_PORT}/v1/health"

    if _wait_for_health(health_url, HEALTH_TIMEOUT_SECONDS):
        boot_elapsed = time.monotonic() - launch_start
        logger.info("Engine is healthy after {:.1f}s — registering with runtime", boot_elapsed)
        registered = _post_register(runtime_url, "kokoro", ENGINE_PORT)
        if registered:
            logger.info("Kokoro engine is live and registered. Heartbeat every 25s.")
            _heartbeat_loop(runtime_url, "kokoro")
    else:
        logger.warning(
            "Engine did not become healthy within {}s — skipping registration.",
            HEALTH_TIMEOUT_SECONDS,
        )

    exit_code = process.wait()
    logger.info("Engine process exited with code {}", exit_code)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()