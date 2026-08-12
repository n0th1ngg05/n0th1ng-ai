"""Path resolution utilities."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()


def get_base_path() -> Path:
    """Get the runtime base directory."""
    return BASE_DIR


def get_cache_path() -> Path:
    """Get the cache directory."""
    return BASE_DIR / "cache"


def get_logs_path() -> Path:
    """Get the logs directory."""
    return BASE_DIR / "logs"


def get_output_path() -> Path:
    """Get the output directory."""
    return BASE_DIR / "output"


def get_temp_path() -> Path:
    """Get the temp directory."""
    return BASE_DIR / "temp"


def get_models_path() -> Path:
    """Get the models directory."""
    return BASE_DIR / "models"


def get_voices_path() -> Path:
    """Get the voices directory."""
    return BASE_DIR / "voices"


def ensure_dir(path: Path) -> Path:
    """Ensure a directory exists."""
    path.mkdir(parents=True, exist_ok=True)
    return path
