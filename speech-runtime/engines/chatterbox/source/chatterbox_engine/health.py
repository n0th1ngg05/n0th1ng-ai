from __future__ import annotations

import time

from chatterbox_engine.schema import ServeHealthResponse


class HealthTracker:
    """Tracks engine start time and reports current health.

    Kept separate from ModelManager so health reporting has no dependency
    on inference internals — it only reads state ModelManager already
    exposes, which keeps /health cheap and safe to poll frequently (the
    runtime's EngineManager polls this every 0.5s during startup).
    """

    def __init__(self):

        self._started_at = time.monotonic()

    def report(self, model_manager) -> ServeHealthResponse:

        model = model_manager.model

        return ServeHealthResponse(
            status="ok" if model is not None else "loading",
            model_loaded=model is not None,
            device=model_manager.device,
            sample_rate=getattr(model, "sr", None) if model is not None else None,
            uptime_seconds=time.monotonic() - self._started_at,
        )
