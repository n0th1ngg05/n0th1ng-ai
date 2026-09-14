"""Health monitoring for the speech runtime."""
import time
import psutil
from dataclasses import dataclass, field, asdict
from typing import Optional, Any
from datetime import datetime

from utils.environment import get_gpu_info
from runtime.logger import get_logger

logger = get_logger("health")


@dataclass
class ProviderHealth:
    """Health status of a provider."""
    provider_id: str
    status: str
    models_loaded: int = 0
    error: Optional[str] = None


@dataclass
class ModelHealth:
    """Health status of a model."""
    model_id: str
    provider_id: str
    status: str
    path: Optional[str] = None
    error: Optional[str] = None


@dataclass
class DeviceHealth:
    """Health status of a device."""
    device_id: str
    device_type: str
    status: str
    error: Optional[str] = None


@dataclass
class HealthReport:
    """Complete health report."""
    overall: str
    uptime_seconds: float
    memory_used_mb: float
    memory_total_mb: float
    cpu_percent: float
    gpu_info: list[dict] = field(default_factory=list)
    providers: list[ProviderHealth] = field(default_factory=list)
    models: list[ModelHealth] = field(default_factory=list)
    devices: list[DeviceHealth] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return asdict(self)


class HealthMonitor:
    """Monitors runtime health."""

    def __init__(self):
        self._start_time = time.time()
        self._errors: list[str] = []
        self._warnings: list[str] = []

    def add_error(self, error: str) -> None:
        """Record an error."""
        self._errors.append(error)
        logger.error(error)

    def add_warning(self, warning: str) -> None:
        """Record a warning."""
        self._warnings.append(warning)
        logger.warning(warning)

    def get_report(
        self,
        providers: list[ProviderHealth] = None,
        models: list[ModelHealth] = None,
        devices: list[DeviceHealth] = None,
    ) -> HealthReport:
        """Generate a complete health report.

        The runtime reports itself as *healthy* as soon as it is up.  An
        empty provider list is normal during the window between startup and
        the first engine self-registration, and does **not** cause a
        degraded status.  Individual unhealthy providers are noted in the
        report for observability but don't affect the top-level status
        either \u2014 the runtime can still serve in-process providers.
        """
        providers = providers or []
        mem = psutil.virtual_memory()
        cpu = psutil.cpu_percent(interval=0.1)
        uptime = time.time() - self._start_time

        overall = "healthy"
        if len(self._errors) >= 3:
            overall = "unhealthy"
        elif self._errors:
            overall = "degraded"

        return HealthReport(
            overall=overall,
            uptime_seconds=uptime,
            memory_used_mb=mem.used / (1024 * 1024),
            memory_total_mb=mem.total / (1024 * 1024),
            cpu_percent=cpu,
            gpu_info=get_gpu_info(),
            providers=providers,
            models=models or [],
            devices=devices or [],
            errors=list(self._errors[-10:]),
            warnings=list(self._warnings[-10:]),
        )

    def clear(self) -> None:
        """Clear errors and warnings."""
        self._errors = []
        self._warnings = []
