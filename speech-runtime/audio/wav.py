"""WAV file utilities."""
import struct
from io import BytesIO
from typing import Tuple
import numpy as np

from runtime.exceptions import AudioError


class WavUtil:
    """WAV format utilities."""

    @staticmethod
    def parse_header(data: bytes) -> Tuple[int, int, int]:
        """Parse WAV header and return (sample_rate, channels, bit_depth)."""
        if len(data) < 44:
            raise AudioError("WAV data too short")
        if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise AudioError("Invalid WAV header")
        channels = struct.unpack("<H", data[22:24])[0]
        sample_rate = struct.unpack("<I", data[24:28])[0]
        bit_depth = struct.unpack("<H", data[34:36])[0]
        return sample_rate, channels, bit_depth

    @staticmethod
    def extract_pcm(data: bytes) -> bytes:
        """Extract raw PCM data from WAV."""
        # Find data chunk
        idx = 12
        while idx < len(data) - 8:
            chunk_id = data[idx:idx+4]
            chunk_size = struct.unpack("<I", data[idx+4:idx+8])[0]
            if chunk_id == b"data":
                return data[idx+8:idx+8+chunk_size]
            idx += 8 + chunk_size
        raise AudioError("WAV data chunk not found")

    @staticmethod
    def build_wav(pcm_data: bytes, sample_rate: int, channels: int = 1, bit_depth: int = 16) -> bytes:
        """Build a WAV file from PCM data."""
        byte_rate = sample_rate * channels * (bit_depth // 8)
        block_align = channels * (bit_depth // 8)
        data_size = len(pcm_data)

        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF",
            36 + data_size,
            b"WAVE",
            b"fmt ",
            16,
            1,
            channels,
            sample_rate,
            byte_rate,
            block_align,
            bit_depth,
            b"data",
            data_size,
        )
        return header + pcm_data

    @staticmethod
    def pcm_to_numpy(pcm_data: bytes, bit_depth: int = 16) -> np.ndarray:
        """Convert PCM bytes to numpy array."""
        if bit_depth == 16:
            return np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
        elif bit_depth == 32:
            return np.frombuffer(pcm_data, dtype=np.int32).astype(np.float32) / 2147483648.0
        elif bit_depth == 8:
            return np.frombuffer(pcm_data, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
        else:
            raise AudioError(f"Unsupported bit depth: {bit_depth}")

    @staticmethod
    def numpy_to_pcm(audio: np.ndarray, bit_depth: int = 16) -> bytes:
        """Convert numpy array to PCM bytes."""
        if bit_depth == 16:
            audio = np.clip(audio, -1.0, 1.0)
            return (audio * 32767).astype(np.int16).tobytes()
        elif bit_depth == 32:
            audio = np.clip(audio, -1.0, 1.0)
            return (audio * 2147483647).astype(np.int32).tobytes()
        else:
            raise AudioError(f"Unsupported bit depth: {bit_depth}")
