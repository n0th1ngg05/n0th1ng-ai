"""General helper utilities."""
import uuid
import time
from typing import Any
from datetime import datetime


def generate_id() -> str:
    """Generate a unique identifier."""
    return str(uuid.uuid4())


def generate_request_id() -> str:
    """Generate a request identifier."""
    return f"req_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"


def format_bytes(size: int) -> str:
    """Format byte size to human readable."""
    if size == 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    while size >= 1024 and idx < len(units) - 1:
        size /= 1024
        idx += 1
    return f"{size:.2f} {units[idx]}"


def format_duration(seconds: float) -> str:
    """Format seconds to mm:ss."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"


def calculate_eta(downloaded: int, total: int, speed: float) -> int:
    """Calculate estimated time of arrival in seconds."""
    if speed <= 0:
        return 0
    remaining = total - downloaded
    return max(0, int(remaining / speed))


def deep_clone(obj: Any) -> Any:
    """Deep clone a serializable object."""
    import json
    return json.loads(json.dumps(obj))


def is_plain_object(value: Any) -> bool:
    """Check if value is a plain dict."""
    return isinstance(value, dict)


def current_timestamp() -> datetime:
    """Get current UTC timestamp."""
    return datetime.utcnow()


def sanitize_filename(name: str) -> str:
    """Sanitize a filename."""
    import re
    sanitized = re.sub(r"[^a-zA-Z0-9._-]", "_", name)
    return sanitized[:100]
