from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import requests

from runtime.config import RuntimeConfig

from runtime.logger import get_logger

logger = get_logger("engine_manager")


class EngineManager:
    """Manages external speech engine processes."""

    def __init__(self, config: RuntimeConfig):
        self.config = config
        self._processes: dict[str, subprocess.Popen] = {}

        self.root = Path(__file__).resolve().parent.parent
        self.engines = self.root / "engines"

    def _engine_dir(self, provider: str) -> Path:
        return self.engines / provider

    def _python(self, provider: str) -> Path:
        engine = self._engine_dir(provider)

        if sys.platform == "win32":
            return engine / ".venv" / "Scripts" / "python.exe"

        return engine / ".venv" / "bin" / "python"

    def _launcher(self, provider: str) -> Path:
        return self._engine_dir(provider) / "launcher.py"

    def _port(self, provider: str) -> int:
        return self.config.engine.ports[provider]

    def base_url(self, provider: str) -> str:
        return f"http://127.0.0.1:{self._port(provider)}"
    
    def get_url(self, provider: str) -> str:
        return self.base_url(provider)

    def is_running(self, provider: str) -> bool:
        process = self._processes.get(provider)

        if process is None:
            return False

        return process.poll() is None

    def health(self, provider: str) -> bool:
        try:
            response = requests.get(
                f"{self.base_url(provider)}/v1/health",
                timeout=2,
            )

            return response.status_code == 200

        except Exception:
            return False

    def start(self, provider: str) -> bool:
        """Launch the engine subprocess and return immediately.

        The engine is responsible for calling ``POST /register`` on the
        runtime once it is ready.  We no longer block here waiting for its
        ``/v1/health`` endpoint — that was the source of the long startup
        delay and the tight coupling between the runtime and its engines.
        """

        # If the engine is already serving (e.g. started externally), skip.
        if self.health(provider):
            logger.info("%s engine is already running", provider)
            return True

        if not self._python(provider).exists():
            raise FileNotFoundError(
                f"Python environment not found for '{provider}'."
            )

        if not self._launcher(provider).exists():
            raise FileNotFoundError(
                f"launcher.py missing for '{provider}'."
            )

        process = subprocess.Popen(
            [
                str(self._python(provider)),
                str(self._launcher(provider)),
            ],
            cwd=str(self._engine_dir(provider)),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        self._processes[provider] = process

        logger.info(
            "Launched %s engine (PID %s) — waiting for self-registration",
            provider,
            process.pid,
        )

        # Fire-and-forget: return immediately.  The engine will POST /register
        # once its model is loaded and its server is ready.
        return True

    def stop(self, provider: str):

        process = self._processes.get(provider)

        if process is None:
            return

        process.terminate()

        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()

        self._processes.pop(provider, None)

    def restart(self, provider: str) -> bool:

        self.stop(provider)

        return self.start(provider)
    
_engine_manager = None

def get_engine_manager(config: RuntimeConfig) -> EngineManager:
    global _engine_manager

    if _engine_manager is None:
        _engine_manager = EngineManager(config)

    return _engine_manager