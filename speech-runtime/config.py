"""Root configuration for the speech runtime."""

from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class RuntimeConfig(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = Field(default="127.0.0.1", alias="SPEECH_RUNTIME_HOST")
    port: int = Field(default=9000, alias="SPEECH_RUNTIME_PORT")
    log_level: str = Field(default="INFO", alias="SPEECH_LOG_LEVEL")
    workers: int = Field(default=1, alias="SPEECH_WORKERS")

    model_cache_dir: str = Field(
        default="./cache",
        alias="SPEECH_MODEL_CACHE_DIR",
    )

    max_concurrent_requests: int = Field(
        default=10,
        alias="SPEECH_MAX_CONCURRENT",
    )

    websocket_enabled: bool = Field(
        default=True,
        alias="SPEECH_WEBSOCKET_ENABLED",
    )

    benchmark_warmup: int = Field(
        default=2,
        alias="SPEECH_BENCHMARK_WARMUP",
    )

    provider_paths: List[str] = Field(
        default=["providers"],
        alias="SPEECH_PROVIDER_PATHS",
    )

    device: str = Field(
        default="auto",
        alias="SPEECH_DEVICE",
    )


settings = RuntimeConfig()