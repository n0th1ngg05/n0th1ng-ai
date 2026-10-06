from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import threading
import urllib.request
import urllib.error
from pathlib import Path

try:
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
except ImportError:
    import logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | kokoro/launcher - %(message)s",
    )
    class FallbackLogger:
        @staticmethod
        def info(msg, *args):
            logging.info(msg.format(*args) if "{" in msg else msg % args if args else msg)
        @staticmethod
        def warning(msg, *args):
            logging.warning(msg.format(*args) if "{" in msg else msg % args if args else msg)
        @staticmethod
        def debug(msg, *args):
            logging.debug(msg.format(*args) if "{" in msg else msg % args if args else msg)
    logger = FallbackLogger()


ROOT = Path(__file__).resolve().parent

SOURCE = ROOT / "source"


def get_python_executable() -> Path:
    """Resolve the Python executable to run the Kokoro engine with.

    Prioritizes the active Python environment from which the launcher was executed,
    allowing seamless switching between environments (e.g. AMD ROCm vs NVIDIA CUDA).

    Resolution order:
    1. KOKORO_PYTHON environment variable (explicit override)
    2. Active Python interpreter (sys.executable) running this script
    3. Active VIRTUAL_ENV environment variable
    4. Fallback to ROOT / ".venv" if it exists
    """
    if "KOKORO_PYTHON" in os.environ:
        custom_py = Path(os.environ["KOKORO_PYTHON"]).resolve()
        if custom_py.exists():
            return custom_py
        logger.warning(
            "KOKORO_PYTHON was set to '{}' but the file does not exist, falling back.",
            os.environ["KOKORO_PYTHON"],
        )

    current_py = Path(sys.executable).resolve()
    if current_py.exists():
        return current_py

    if "VIRTUAL_ENV" in os.environ:
        venv_root = Path(os.environ["VIRTUAL_ENV"]).resolve()
        venv_py = (
            venv_root / "Scripts" / "python.exe"
            if os.name == "nt"
            else venv_root / "bin" / "python"
        )
        if venv_py.exists():
            return venv_py

    default_venv_py = (
        ROOT / ".venv" / "Scripts" / "python.exe"
        if os.name == "nt"
        else ROOT / ".venv" / "bin" / "python"
    ).resolve()
    if default_venv_py.exists():
        return default_venv_py

    return current_py


PYTHON = get_python_executable()

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


def _heartbeat_loop(runtime_url: str, provider_id: str, port: int = ENGINE_PORT, interval: int = 25) -> None:
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
                        _post_register(runtime_url, provider_id, port)
                    else:
                        logger.debug("Heartbeat #{} ok", beat_count)
            except Exception as exc:
                logger.debug("Heartbeat failed (will retry): {}", exc)

    t = threading.Thread(target=_beat, daemon=True, name="kokoro-heartbeat")
    t.start()


def parse_args():
    parser = argparse.ArgumentParser(description="Kokoro Engine Launcher")
    parser.add_argument(
        "--python",
        default=None,
        help="Path to python executable (overrides active venv and KOKORO_PYTHON)",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("KOKORO_DEVICE", "cuda"),
        help="Device to run on (e.g. cuda, cuda:0, cuda:1, cpu). Default: cuda or $KOKORO_DEVICE",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("KOKORO_HOST", ENGINE_HOST),
        help=f"Host to bind (default: {ENGINE_HOST})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("KOKORO_PORT", str(ENGINE_PORT))),
        help=f"Port to bind (default: {ENGINE_PORT})",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    python_bin = Path(args.python).resolve() if args.python else get_python_executable()

    if not python_bin.exists():
        raise FileNotFoundError(f"Python executable not found: {python_bin}")

    if not API_SERVER.exists():
        raise FileNotFoundError(f"API server script not found: {API_SERVER}")

    logger.info("=" * 50)
    logger.info("  KOKORO ENGINE LAUNCHER")
    logger.info("=" * 50)
    logger.info("Python  : {}", python_bin)
    logger.info("Server  : {}", API_SERVER)
    logger.info("Device  : {}", args.device)
    logger.info("Host    : {}", args.host)
    logger.info("Port    : {}", args.port)

    runtime_url = os.environ.get("SPEECH_RUNTIME_URL", DEFAULT_RUNTIME_URL).rstrip("/")
    logger.info("Runtime : {}", runtime_url)
    logger.info("=" * 50)

    launch_start = time.monotonic()

    env = os.environ.copy()

    command = [
        str(python_bin),
        str(API_SERVER),
        "--device",
        args.device,
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]

    process = subprocess.Popen(
        command,
        cwd=str(SOURCE),
        env=env,
    )

    logger.info(
        "Engine started (PID {}) — waiting for /v1/health on {}:{} …",
        process.pid, args.host, args.port,
    )

    health_url = f"http://{args.host}:{args.port}/v1/health"

    if _wait_for_health(health_url, HEALTH_TIMEOUT_SECONDS):
        boot_elapsed = time.monotonic() - launch_start
        logger.info("Engine is healthy after {:.1f}s — registering with runtime", boot_elapsed)
        registered = _post_register(runtime_url, "kokoro", args.port)
        if registered:
            logger.info("Kokoro engine is live and registered. Heartbeat every 25s.")
            _heartbeat_loop(runtime_url, "kokoro", port=args.port)
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