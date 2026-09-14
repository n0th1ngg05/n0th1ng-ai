"""Silence detection utilities."""
import numpy as np
from typing import List, Tuple
from dataclasses import dataclass

from runtime.exceptions import AudioError


@dataclass
class SilenceResult:
    """Result of silence detection."""
    is_speech: bool
    speech_start: float
    speech_end: float
    segments: List[Tuple[float, float]]


class SilenceDetector:
    """Energy-based silence detector."""

    def __init__(self, threshold: float = 0.01, min_silence_duration: float = 0.3, min_speech_duration: float = 0.2):
        self.threshold = threshold
        self.min_silence_duration = min_silence_duration
        self.min_speech_duration = min_speech_duration

    def detect(self, audio: np.ndarray, sample_rate: int) -> SilenceResult:
        """Detect speech segments in audio."""
        if audio.size == 0:
            return SilenceResult(False, 0.0, 0.0, [])

        frame_size = int(sample_rate * 0.02)
        frames = len(audio) // frame_size
        energies = []
        for i in range(frames):
            frame = audio[i * frame_size:(i + 1) * frame_size]
            energy = np.sqrt(np.mean(frame ** 2))
            energies.append(energy)

        energies = np.array(energies)
        is_speech = energies > self.threshold

        segments: List[Tuple[float, float]] = []
        start = None
        for i, speech in enumerate(is_speech):
            if speech and start is None:
                start = i
            elif not speech and start is not None:
                duration = (i - start) * 0.02
                if duration >= self.min_speech_duration:
                    segments.append((start * 0.02, i * 0.02))
                start = None
        if start is not None:
            duration = (len(is_speech) - start) * 0.02
            if duration >= self.min_speech_duration:
                segments.append((start * 0.02, len(is_speech) * 0.02))

        if not segments:
            return SilenceResult(False, 0.0, 0.0, [])

        return SilenceResult(
            True,
            segments[0][0],
            segments[-1][1],
            segments,
        )
