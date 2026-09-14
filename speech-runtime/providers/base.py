"""Abstract base class for all speech providers."""
from abc import ABC, abstractmethod
from typing import Any, Optional
from dataclasses import dataclass, field
from runtime.exceptions import ProviderError


@dataclass
class ProviderManifest:
    id: str
    name: str
    version: str
    description: str
    author: str
    license: str
    # Accept both 'type' and 'provider_type' for backward compatibility.
    # Stored as provider_type internally.
    provider_type: str = "tts"           # tts / stt / hybrid
    # Alias: providers pass type= as a keyword arg
    supported_languages: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    supports_tts: bool = False
    supports_stt: bool = False
    supports_streaming: bool = False
    supports_voice_cloning: bool = False
    supports_benchmark: bool = True
    supports_cpu: bool = True
    supports_gpu: bool = True
    homepage: str = ""
    repository: str = ""

    # Allow providers to use type= instead of provider_type=
    def __init__(
        self,
        id: str,
        name: str,
        version: str,
        description: str,
        author: str,
        license: str,
        provider_type: str = "tts",
        type: str = "",          # alias for provider_type
        supported_languages: list = None,
        capabilities: list = None,
        supports_tts: bool = False,
        supports_stt: bool = False,
        supports_streaming: bool = False,
        supports_voice_cloning: bool = False,
        supports_benchmark: bool = True,
        supports_cpu: bool = True,
        supports_gpu: bool = True,
        homepage: str = "",
        repository: str = "",
    ):
        self.id = id
        self.name = name
        self.version = version
        self.description = description
        self.author = author
        self.license = license
        # 'type' kwarg is an alias for 'provider_type'
        self.provider_type = type if type else provider_type
        self.supported_languages = supported_languages or []
        self.capabilities = capabilities or []
        self.supports_tts = supports_tts
        self.supports_stt = supports_stt
        self.supports_streaming = supports_streaming
        self.supports_voice_cloning = supports_voice_cloning
        self.supports_benchmark = supports_benchmark
        self.supports_cpu = supports_cpu
        self.supports_gpu = supports_gpu
        self.homepage = homepage
        self.repository = repository

    @property
    def type(self) -> str:
        """Alias so code can read .type as well as .provider_type."""
        return self.provider_type


@dataclass
class ModelInfo:
    id: str
    name: str
    version: str
    size: int
    languages: list[str]
    capabilities: list[str]
    installed: bool = False
    downloaded: bool = False
    loaded: bool = False
    checksum: str = ""
    checksum_algorithm: str = "sha256"
    download_url: str = ""
    local_path: str = ""
    requires_gpu: bool = False
    description: str = ""


@dataclass
class VoiceInfo:
    id: str
    name: str
    language: str
    gender: str
    description: str
    sample_rate: int = 22050
    is_default: bool = False
    downloaded: bool = True
    local_path: str = ""


@dataclass
class TTSRequest:
    """Text-to-speech request."""

    text: str

    model_id: Optional[str] = None

    voice_id: Optional[str] = None

    #
    # Voice dataset (FishSpeech, XTTS, Chatterbox...)
    #
    reference_id: Optional[str] = None

    speed: float = 1.0
    pitch: float = 1.0
    temperature: float = 0.7
    volume: float = 1.0
    emotion: str = "neutral"
    language: str = "en"
    format: str = "wav"
    sample_rate: int = 22050


@dataclass
class TTSResponse:
    """Text-to-speech response."""
    audio_data: bytes
    format: str
    sample_rate: int
    duration: float
    model_id: str
    voice_id: str


@dataclass
class STTRequest:
    """Speech-to-text request."""
    audio_data: bytes
    format: str = "wav"
    sample_rate: int = 16000
    model_id: Optional[str] = None
    language: Optional[str] = None
    channels: int = 1


@dataclass
class STTResponse:
    """Speech-to-text response."""
    text: str
    confidence: float
    model_id: str
    language: str
    segments: list[dict] = field(default_factory=list)


@dataclass
class BenchmarkConfig:
    """Benchmark configuration."""
    model_id: str
    voice_id: Optional[str] = None
    iterations: int = 10
    warmup: int = 2
    text: Optional[str] = None
    audio_data: Optional[bytes] = None
    test_type: str = "tts"


@dataclass
class BenchmarkResult:
    """Benchmark result."""
    latency_ms: float
    load_time_ms: float
    inference_speed: float
    rtf: float
    memory_usage_mb: float
    

@dataclass
class ProviderStats:
    initialized: bool
    loaded_model: str | None
    device: str
    gpu: bool
    models: int
    voices: int


class BaseProvider(ABC):
    """Abstract base class for all speech providers."""

    def __init__(self):
        self._initialized = False
        self.runtime = None
        self._loaded_model: Optional[str] = None
        self._device = "cpu"
        self._models = {}
        self._voices = {}

    @property
    @abstractmethod
    def id(self) -> str:
        """Provider unique identifier."""
        ...

    @property
    @abstractmethod
    def manifest(self) -> ProviderManifest:
        """Provider manifest."""
        ...

    @property
    def is_initialized(self) -> bool:
        """Whether the provider is initialized."""
        return self._initialized

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the provider."""
        ...

    @abstractmethod
    async def shutdown(self) -> None:
        """Shutdown the provider."""
        ...

    @abstractmethod
    async def health(self) -> dict[str, Any]:
        """Return provider health status."""
        ...

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """List available models."""
        ...

    async def get_model(self, model_id: str) -> ModelInfo:
        """Get a model by ID. Default: search list_models()."""
        models = await self.list_models()
        for m in models:
            if m.id == model_id:
                return m
        raise ProviderError(f"Model {model_id} not found", self.id)

    @abstractmethod
    async def list_voices(self) -> list[VoiceInfo]:
        """List available voices."""
        ...

    async def get_voice(self, voice_id: str) -> VoiceInfo:
        """Get a voice by ID. Default: search list_voices()."""
        voices = await self.list_voices()
        for v in voices:
            if v.id == voice_id:
                return v
        raise ProviderError(f"Voice {voice_id} not found", self.id)

    async def install_model(self, model_id: str) -> bool:
        """Install/download a model. Providers can override for real download logic."""
        return False

    async def install_voice(self, voice_id: str) -> bool:
        """Install/download a voice. Providers can override for real download logic."""
        return False

    async def uninstall_voice(self, voice_id: str) -> bool:
        """Uninstall a voice. Providers can override."""
        return False

    @abstractmethod
    async def load_model(self, model_id: str) -> None:
        """Load a model."""
        ...

    @abstractmethod
    async def unload_model(self) -> None:
        """Unload the current model."""
        ...

    @abstractmethod
    async def synthesize(self, request: TTSRequest) -> TTSResponse:
        """Synthesize speech."""
        ...

    @abstractmethod
    async def transcribe(self, request: STTRequest) -> STTResponse:
        """Transcribe speech."""
        ...

    async def stats(self) -> ProviderStats:

        return ProviderStats(
            initialized=self._initialized,
            loaded_model=self._loaded_model,
            device=self._device,
            gpu=self._device == "cuda",
            models=len(await self.list_models()),
            voices=len(await self.list_voices())
        )

    @abstractmethod
    async def benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        """Run benchmark."""
        ...

    def _ensure_initialized(self) -> None:
        """Raise if not initialized."""
        if not self._initialized:
            raise RuntimeError(f"Provider {self.id} is not initialized")
