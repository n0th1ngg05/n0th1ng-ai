"""Input validation utilities."""
from typing import Any
from utils.constants import MAX_TEXT_LENGTH, SUPPORTED_LANGUAGES, AUDIO_FORMATS
from runtime.exceptions import ValidationError


def validate_tts_request(request: dict[str, Any]) -> None:
    """Validate a TTS request payload."""
    text = request.get("text")
    if not isinstance(text, str) or not text:
        raise ValidationError("TTS request must contain non-empty text")
    if len(text) > MAX_TEXT_LENGTH:
        raise ValidationError(f"Text exceeds maximum length of {MAX_TEXT_LENGTH}")


def validate_stt_request(request: dict[str, Any]) -> None:
    """Validate an STT request payload."""
    audio = request.get("audio")
    if not audio:
        raise ValidationError("STT request must contain audio data")
    fmt = request.get("format", "wav")
    if fmt not in AUDIO_FORMATS:
        raise ValidationError(f"Unsupported audio format: {fmt}")
    sample_rate = request.get("sample_rate", 0)
    # 0 means "unspecified" — stt.py will default it to 16000 before conversion.
    # Any explicitly provided value must be in a sane range.
    if sample_rate != 0 and (not isinstance(sample_rate, int) or sample_rate < 8000 or sample_rate > 192000):
        raise ValidationError("Invalid sample rate")


def validate_language(language: str) -> None:
    """Validate a language code."""
    if language not in SUPPORTED_LANGUAGES:
        raise ValidationError(f"Unsupported language: {language}")


def validate_profile(profile: dict[str, Any]) -> None:
    """Validate a voice profile."""
    required = ["name", "provider_id", "model_id", "voice_id"]
    for field in required:
        if not profile.get(field):
            raise ValidationError(f"Profile missing required field: {field}")
    speed = profile.get("speed", 1.0)
    if not (0.5 <= speed <= 2.0):
        raise ValidationError("Speed must be between 0.5 and 2.0")
    pitch = profile.get("pitch", 1.0)
    if not (0.5 <= pitch <= 2.0):
        raise ValidationError("Pitch must be between 0.5 and 2.0")
    temperature = profile.get("temperature", 0.7)
    if not (0.0 <= temperature <= 1.0):
        raise ValidationError("Temperature must be between 0.0 and 1.0")
    volume = profile.get("volume", 1.0)
    if not (0.0 <= volume <= 1.0):
        raise ValidationError("Volume must be between 0.0 and 1.0")