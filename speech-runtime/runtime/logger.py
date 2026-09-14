"""Structured logging for the speech runtime."""
import logging
import sys
from pathlib import Path
from typing import Optional
from datetime import datetime

from utils.paths import get_logs_path

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_root_logger: Optional[logging.Logger] = None


def setup_logging(level: str = "INFO") -> None:
    """Setup root logging configuration."""
    global _root_logger
    if _root_logger is not None:
        return

    logs_dir = get_logs_path()
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / f"runtime_{datetime.utcnow().strftime('%Y%m%d')}.log"

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))

    _root_logger = logging.getLogger("speech_runtime")
    _root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    _root_logger.addHandler(handler)
    _root_logger.addHandler(file_handler)
    _root_logger.propagate = False


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance."""
    if _root_logger is None:
        setup_logging()
    return logging.getLogger(f"speech_runtime.{name}")
