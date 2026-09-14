"""Voice Activity Detection."""
import numpy as np
from typing import List
from dataclasses import dataclass

from runtime.exceptions import AudioError


@dataclass
class VADSegment:
    """VAD segment."""
    start: float
    end: float
    is_speech: bool


class VoiceActivityDetector:
    """Simple energy-based VAD."""

    def __init__(self, aggressiveness: int = 2):
        self.aggressiveness = aggressiveness
        self.thresholds = [0.005, 0.01, 0.015, 0.02]
        self.threshold = self.thresholds[min(aggressiveness, len(self.thresholds) - 1)]

    def detect(self, audio: np.ndarray, sample_rate: int) -> List[VADSegment]:
        """Detect voice activity segments."""
        if audio.size == 0:
            return []

        frame_size = int(sample_rate * 0.03)
        hop_size = int(sample_rate * 0.01)
        frames = (len(audio) - frame_size) // hop_size + 1

        is_speech = []
        for i in range(frames):
            frame = audio[i * hop_size:i * hop_size + frame_size]
            energy = np.sqrt(np.mean(frame ** 2))
            is_speech.append(energy > self.threshold)

        segments: List[VADSegment] = []
        current_start = 0.0
        current_speech = is_speech[0] if is_speech else False

        for i, speech in enumerate(is_speech):
            time = i * hop_size / sample_rate
            if speech != current_speech:
                segments.append(VADSegment(current_start, time, current_speech))
                current_start = time
                current_speech = speech

        if segments and current_start < (len(audio) / sample_rate):
            segments.append(VADSegment(current_start, len(audio) / sample_rate, current_speech))

        return segments
