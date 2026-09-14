"""CLI launcher for the speech runtime."""
import argparse
import sys
import os

from main import main
from runtime.logger import get_logger

logger = get_logger("launcher")


def check_python_version():
    """Ensure Python 3.11 or higher."""
    if sys.version_info < (3, 11):
        logger.error("Python 3.11+ is required")
        sys.exit(1)


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="n0th1ng AI Speech Runtime")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=9000, help="Port to bind")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    parser.add_argument("--workers", type=int, default=1, help="Number of workers")
    parser.add_argument("--device", default="auto", help="Device (cpu/cuda/auto)")
    return parser.parse_args()


def apply_args(args):
    """Apply CLI arguments to environment."""
    os.environ["SPEECH_RUNTIME_HOST"] = args.host
    os.environ["SPEECH_RUNTIME_PORT"] = str(args.port)
    os.environ["SPEECH_LOG_LEVEL"] = args.log_level
    os.environ["SPEECH_WORKERS"] = str(args.workers)
    os.environ["SPEECH_DEVICE"] = args.device


def launch():
    """Launch the runtime."""
    check_python_version()
    args = parse_args()
    apply_args(args)
    logger.info("Launching n0th1ng AI Speech Runtime")
    main()


if __name__ == "__main__":
    launch()
