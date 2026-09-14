"""Voice validation utilities."""
from typing import Optional

from runtime.exceptions import ValidationError


class VoiceValidator:
    """Validates voice parameters."""

    @staticmethod
    def validate_speed(speed: float) -> None:
        if not (0.5 <= speed <= 2.0):
            raise ValidationError("Speed must be between 0.5 and 2.0")

    @staticmethod
    def validate_pitch(pitch: float) -> None:
        if not (0.5 <= pitch <= 2.0):
            raise ValidationError("Pitch must be between 0.5 and 2.0")

    @staticmethod
    def validate_temperature(temperature: float) -> None:
        if not (0.0 <= temperature <= 1.0):
            raise ValidationError("Temperature must be between 0.0 and 1.0")

    @staticmethod
    def validate_volume(volume: float) -> None:
        if not (0.0 <= volume <= 1.0):
            raise ValidationError("Volume must be between 0.0 and 1.0")

    @staticmethod
    def validate_voice_id(voice_id: str) -> None:
        if not voice_id or not isinstance(voice_id, str):
            raise ValidationError("Voice ID must be a non-empty string")
