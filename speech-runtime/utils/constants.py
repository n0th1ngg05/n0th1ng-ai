"""System-wide constants."""
from typing import Final

DEFAULT_SAMPLE_RATE: Final[int] = 22050
DEFAULT_CHANNELS: Final[int] = 1
DEFAULT_BIT_DEPTH: Final[int] = 16
DEFAULT_AUDIO_FORMAT: Final[str] = "wav"

DEFAULT_SPEED: Final[float] = 1.0
DEFAULT_PITCH: Final[float] = 1.0
DEFAULT_TEMPERATURE: Final[float] = 0.7
DEFAULT_VOLUME: Final[float] = 1.0
DEFAULT_EMOTION: Final[str] = "neutral"

MAX_TEXT_LENGTH: Final[int] = 10000
MAX_AUDIO_DURATION_SECONDS: Final[int] = 300
MAX_DOWNLOAD_RETRIES: Final[int] = 3
DOWNLOAD_CHUNK_SIZE: Final[int] = 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS: Final[int] = 300

RUNTIME_START_TIMEOUT: Final[int] = 30
RUNTIME_STOP_TIMEOUT: Final[int] = 10
HEARTBEAT_INTERVAL_SECONDS: Final[int] = 5
MAX_RUNTIME_RETRIES: Final[int] = 3

BENCHMARK_WARMUP_ITERATIONS: Final[int] = 2
BENCHMARK_DEFAULT_ITERATIONS: Final[int] = 10

SUPPORTED_LANGUAGES: Final[list[str]] = [
    "en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko", "ru", "ar", "hi"
]

AUDIO_FORMATS: Final[list[str]] = ["wav", "mp3", "ogg", "pcm", "flac", "webm"]

PROVIDER_IDS: Final[list[str]] = [
    "kokoro", "piper", "xtts", "fishspeech", "chatterbox", "dia", "whisper"
]
