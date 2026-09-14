"""Checksum verification utilities."""
import hashlib
from pathlib import Path
from typing import Literal

Algorithm = Literal["sha256", "md5"]


def checksum_buffer(data: bytes, algorithm: Algorithm = "sha256") -> str:
    """Compute checksum of a byte buffer."""
    hasher = hashlib.new(algorithm)
    hasher.update(data)
    return hasher.hexdigest()


def checksum_file(path: Path, algorithm: Algorithm = "sha256") -> str:
    """Compute checksum of a file."""
    hasher = hashlib.new(algorithm)
    with open(path, "rb") as f:
        while chunk := f.read(8192):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_buffer(data: bytes, expected: str, algorithm: Algorithm = "sha256") -> bool:
    """Verify buffer against expected checksum."""
    return checksum_buffer(data, algorithm) == expected.lower()


def verify_file(path: Path, expected: str, algorithm: Algorithm = "sha256") -> bool:
    """Verify file against expected checksum."""
    return checksum_file(path, algorithm) == expected.lower()
