"""Runtime-specific configuration."""
from pydantic import BaseModel, Field
from typing import List


class RuntimeServerConfig(BaseModel):
    """Runtime server configuration."""
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=9000)
    log_level: str = Field(default="INFO")
    max_workers: int = Field(default=4)
    request_timeout: int = Field(default=300)
    websocket_enabled: bool = Field(default=True)


class AudioConfig(BaseModel):
    """Audio processing configuration."""
    default_sample_rate: int = Field(default=22050)
    default_channels: int = Field(default=1)
    default_bit_depth: int = Field(default=16)
    max_duration_seconds: int = Field(default=300)


class InferenceConfig(BaseModel):
    """Inference configuration."""
    device: str = Field(default="auto")
    batch_size: int = Field(default=1)
    max_concurrent: int = Field(default=10)
    use_half_precision: bool = Field(default=False)


class CacheConfig(BaseModel):
    """Cache configuration."""
    max_models: int = Field(default=3)
    max_voices: int = Field(default=10)
    ttl_seconds: int = Field(default=3600)


class WebSocketConfig(BaseModel):
    """WebSocket configuration."""
    enabled: bool = Field(default=True)
    max_connections: int = Field(default=100)
    ping_interval: int = Field(default=20)
    ping_timeout: int = Field(default=10)


class EngineConfig(BaseModel):
    """Remote speech-engine subprocess configuration.

    ``ports`` maps a provider id (e.g. "fishspeech") to the local TCP port
    its engine subprocess listens on. These match the fallback base_url
    ports hardcoded in each provider (fishspeech=6101, chatterbox=6102).
    ``auto_start`` controls whether RuntimeManager.initialize() launches
    the engine subprocesses itself (fire-and-forget) on startup.
    """
    ports: dict[str, int] = Field(
        default_factory=lambda: {"fishspeech": 6101, "chatterbox": 6102, "kokoro": 6103}
    )
    auto_start: bool = Field(default=False)


class RuntimeConfig(BaseModel):
    """Complete runtime configuration."""
    server: RuntimeServerConfig = Field(default_factory=RuntimeServerConfig)
    audio: AudioConfig = Field(default_factory=AudioConfig)
    inference: InferenceConfig = Field(default_factory=InferenceConfig)
    cache: CacheConfig = Field(default_factory=CacheConfig)
    websocket: WebSocketConfig = Field(default_factory=WebSocketConfig)
    engine: EngineConfig = Field(default_factory=EngineConfig)
    provider_paths: List[str] = Field(default=["providers"])