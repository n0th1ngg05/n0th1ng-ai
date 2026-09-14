"""Audio resampling utilities."""
import numpy as np

from runtime.exceptions import AudioError


class Resampler:
    """Audio resampler using linear interpolation."""

    @staticmethod
    def resample(audio: np.ndarray, orig_rate: int, target_rate: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        if orig_rate == target_rate:
            return audio
        ratio = target_rate / orig_rate
        target_length = int(len(audio) * ratio)
        indices = np.linspace(0, len(audio) - 1, target_length)
        indices_floor = np.floor(indices).astype(np.int64)
        indices_ceil = np.minimum(indices_floor + 1, len(audio) - 1)
        frac = indices - indices_floor
        return audio[indices_floor] * (1 - frac) + audio[indices_ceil] * frac

    @staticmethod
    def resample_pcm(pcm_data: bytes, orig_rate: int, target_rate: int, channels: int = 1, bit_depth: int = 16) -> bytes:
        """Resample PCM byte data."""
        if bit_depth != 16:
            raise AudioError("Only 16-bit PCM resampling is supported")
        arr = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32)
        if channels > 1:
            arr = arr.reshape(-1, channels)
        resampled = Resampler.resample(arr, orig_rate, target_rate)
        return resampled.astype(np.int16).tobytes()
