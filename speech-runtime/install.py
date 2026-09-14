"""Installation and setup script for the speech runtime."""
import os
import sys
import subprocess
from pathlib import Path

REQUIRED_DIRS = ["cache", "logs", "output", "temp", "models", "voices"]
MIN_PYTHON = (3, 11)


def check_python():
    """Verify Python version."""
    if sys.version_info < MIN_PYTHON:
        print(f"ERROR: Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]}+ required")
        sys.exit(1)
    print(f"OK: Python {sys.version_info.major}.{sys.version_info.minor}")


def create_directories():
    """Create required runtime directories."""
    base = Path(__file__).parent
    for name in REQUIRED_DIRS:
        path = base / name
        path.mkdir(parents=True, exist_ok=True)
        print(f"OK: Directory {name}")


def install_dependencies():
    """Install Python dependencies."""
    req_file = Path(__file__).parent / "requirements.txt"
    if not req_file.exists():
        print("WARNING: requirements.txt not found")
        return
    print("Installing dependencies...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(req_file)])
    print("OK: Dependencies installed")


def verify_environment():
    """Verify the environment is ready."""
    try:
        import fastapi
        import uvicorn
        import pydantic
        print("OK: Core dependencies available")
    except ImportError as e:
        print(f"WARNING: Missing dependency: {e}")


def main():
    """Run installation."""
    print("=== n0th1ng AI Speech Runtime Installer ===")
    check_python()
    create_directories()
    install_dependencies()
    verify_environment()
    print("=== Installation Complete ===")


if __name__ == "__main__":
    main()
