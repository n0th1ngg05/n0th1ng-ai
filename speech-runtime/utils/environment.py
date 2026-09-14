"""Environment and system checks."""
import sys
import platform
import psutil
from typing import Optional


def get_python_version() -> str:
    """Get the current Python version."""
    return f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"


def get_system_info() -> dict:
    """Get system information."""
    return {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
        "python_version": get_python_version(),
        "cpu_count": psutil.cpu_count(),
        "memory_total": psutil.virtual_memory().total,
    }


def get_gpu_info() -> list[dict]:
    """Get GPU information if available."""
    try:
        import torch
        gpus = []
        if torch.cuda.is_available():
            for i in range(torch.cuda.device_count()):
                gpus.append({
                    "id": i,
                    "name": torch.cuda.get_device_name(i),
                    "memory_total": torch.cuda.get_device_properties(i).total_memory,
                })
        return gpus
    except ImportError:
        return []


def get_device_preference(configured: str = "auto") -> str:
    """Determine the best device to use."""
    if configured != "auto":
        return configured
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"
