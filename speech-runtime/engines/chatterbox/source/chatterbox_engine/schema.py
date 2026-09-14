from __future__ import annotations

from pydantic import BaseModel, Field


class ServeTTSRequest(BaseModel):

    text: str

    model_id: str = "chatterbox-tts"

    temperature: float = Field(
        default=0.8,
        ge=0.0,
        le=2.0,
    )

    exaggeration: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
    )

    cfg_weight: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
    )

    voice_id: str | None = None

    audio_prompt: bytes | None = None

    streaming: bool = False

    format: str = "wav"


class ServeTTSResponse(BaseModel):

    audio: bytes

    sample_rate: int

    duration: float


class ServeModelInfo(BaseModel):

    id: str

    name: str

    version: str

    loaded: bool

    device: str

    sample_rate: int


class ServeModelsResponse(BaseModel):

    models: list[ServeModelInfo]


class ServeVoiceInfo(BaseModel):

    id: str

    name: str

    language: str = "en"

    description: str = ""

    is_default: bool = False

    is_cloned: bool = False

    sample_rate: int = 24000

    source_path: str | None = None


class ServeVoicesResponse(BaseModel):

    voices: list[ServeVoiceInfo]


class ServeHealthResponse(BaseModel):

    status: str

    model_loaded: bool

    device: str

    sample_rate: int | None = None

    uptime_seconds: float = 0.0


class ServeBenchmarkRequest(BaseModel):

    text: str = "Hello, this is a benchmark test of the Chatterbox engine."

    iterations: int = Field(default=5, ge=1, le=50)

    warmup: int = Field(default=1, ge=0, le=10)

    voice_id: str | None = None


class ServeBenchmarkResponse(BaseModel):

    load_time_ms: float

    avg_inference_ms: float

    min_inference_ms: float

    max_inference_ms: float

    avg_rtf: float

    inference_speed: float

    gpu_memory_allocated_mb: float

    gpu_memory_reserved_mb: float

    iterations: int
