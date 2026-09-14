"""Audio normalization utilities."""
import numpy as np

from runtime.exceptions import AudioError


class AudioNormalizer:
    """Audio normalization methods."""

    @staticmethod
    def normalize_peak(audio: np.ndarray, target_level: float = 0.95) -> np.ndarray:
        """Peak normalization."""
        peak = np.max(np.abs(audio))
        if peak == 0:
            return audio
        gain = target_level / peak
        return np.clip(audio * gain, -1.0, 1.0)

    @staticmethod
    def normalize_rms(audio: np.ndarray, target_level: float = 0.1) -> np.ndarray:
        """RMS normalization."""
        rms = np.sqrt(np.mean(audio ** 2))
        if rms == 0:
            return audio
        gain = target_level / rms
        return np.clip(audio * gain, -1.0, 1.0)

    @staticmethod
    def normalize(audio: np.ndarray, method: str = "peak", target_level: float = 0.95) -> np.ndarray:
        """Normalize audio."""
        if method == "peak":
            return AudioNormalizer.normalize_peak(audio, target_level)
        elif method == "rms":
            return AudioNormalizer.normalize_rms(audio, target_level)
        else:
            raise AudioError(f"Unknown normalization method: {method}")
