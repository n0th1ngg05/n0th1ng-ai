from __future__ import annotations

import io
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from loguru import logger


def resolve_device(requested: str) -> str:
    """Resolve a requested device string against actual hardware availability.

    Falls back to CPU with a warning if CUDA was requested but is not
    available, rather than letting torch raise deep inside model loading.
    """

    if requested == "cuda" and not torch.cuda.is_available():

        logger.warning(
            "CUDA requested but not available — falling back to CPU."
        )

        return "cpu"

    return requested


def tensor_to_wav_bytes(
    wav: torch.Tensor,
    sample_rate: int,
) -> tuple[bytes, np.ndarray]:
    """Convert a Chatterbox output tensor (1, samples) to WAV bytes.

    Returns both the encoded bytes and the underlying float32 numpy array
    (the latter is reused by callers that also need duration/RTF figures
    without re-decoding the WAV).
    """

    audio = wav.squeeze(0).cpu().numpy().astype(np.float32)

    peak = np.abs(audio).max()

    if peak > 0:
        audio = audio / peak * 0.95

    buffer = io.BytesIO()

    sf.write(
        buffer,
        audio,
        sample_rate,
        format="WAV",
    )

    return buffer.getvalue(), audio


def resolve_audio_prompt_path(
    ad_hoc_prompt: bytes | None,
    voice_audio_path: Path | None,
) -> tuple[str | None, Path | None]:
    """Return (path_to_pass_to_generate, temp_file_to_clean_up_after).

    ChatterboxTTS.generate() only accepts a file path for conditioning
    audio, not raw bytes, so an ad-hoc audio_prompt sent over HTTP (e.g.
    from the runtime's shared VoiceLibrary) has to be spilled to a temp
    file for the duration of the call. An ad-hoc prompt takes priority
    over a voice_id's own stored reference clip since it represents an
    explicit per-request override; callers must unlink the returned temp
    file path once generation completes.
    """

    if ad_hoc_prompt:

        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)

        tmp.write(ad_hoc_prompt)

        tmp.close()

        return tmp.name, Path(tmp.name)

    if voice_audio_path:
        return str(voice_audio_path), None

    return None, None


def gpu_memory_stats() -> tuple[float, float]:
    """Return (allocated_mb, reserved_mb) for the current CUDA device.

    Returns (0.0, 0.0) when CUDA is unavailable rather than raising, since
    health/benchmark endpoints must still respond on CPU-only workers.
    """

    if not torch.cuda.is_available():
        return 0.0, 0.0

    allocated = torch.cuda.memory_allocated() / (1024 * 1024)

    reserved = torch.cuda.memory_reserved() / (1024 * 1024)

    return allocated, reserved


def gpu_cleanup() -> None:
    """Release cached CUDA memory. No-op on CPU-only workers."""

    if torch.cuda.is_available():

        torch.cuda.empty_cache()

        torch.cuda.synchronize()
