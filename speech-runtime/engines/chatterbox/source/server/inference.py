from __future__ import annotations

import time

import numpy as np
import soundfile as sf
import io

from loguru import logger

from chatterbox_engine.schema import ServeTTSRequest, ServeTTSResponse
from chatterbox_engine.streaming import split_into_chunks
from chatterbox_engine.utils import resolve_audio_prompt_path, tensor_to_wav_bytes
from server.model_manager import ModelManager

# Above this length, split into sentence chunks and generate them one at a
# time instead of a single monolithic model.generate() call. This does NOT
# reduce total compute (generation is still sequential either way — see
# the note on shared mutable state below) but it fixes the real practical
# problems with one giant call on long text: T3.inference() is capped at
# max_new_tokens=1000 per call, so a long paragraph risks silently
# truncating mid-sentence when it runs out of steps, whereas each
# individual sentence chunk comfortably fits under that cap on its own.
# Short requests are left as a single call — chunking has no benefit
# there and would only add per-chunk overhead (retokenizing, re-resolving
# conditionals, WAV re-encoding per piece).
_CHUNK_THRESHOLD_CHARS = 200

# ChatterboxTTS.generate() mutates self.conds in place on every call (see
# chatterbox/tts.py) — that's shared mutable state on the single resident
# model instance, so chunks MUST be generated one after another, never
# concurrently, or two chunks racing on self.conds would silently corrupt
# each other's exaggeration/reference conditioning (or crash mid-tensor
# read). This is why chunking here is sequential rather than dispatched to
# a thread pool.


def _generate_single(
    model,
    text: str,
    temperature: float,
    exaggeration: float,
    cfg_weight: float,
    audio_prompt_path: str | None,
) -> np.ndarray:
    """Run one generation call and return the raw float32 audio array."""

    wav = model.generate(
        text=text,
        temperature=temperature,
        repetition_penalty=1.2,
        min_p=0.05,
        top_p=1.0,
        exaggeration=exaggeration,
        cfg_weight=cfg_weight,
        audio_prompt_path=audio_prompt_path,
    )

    _, audio = tensor_to_wav_bytes(wav, model.sr)

    return audio


def synthesize(
    model_manager: ModelManager,
    request: ServeTTSRequest,
) -> ServeTTSResponse:
    """Run one synthesis request against the resident model.

    All inference logic — voice resolution, generation, tensor-to-WAV
    conversion, latency measurement, and error handling — lives here so
    routes.py stays a thin HTTP layer with no knowledge of the model or
    tensors.
    """

    if model_manager.model_id != request.model_id:
        logger.info("Switching Chatterbox Model: {} -> {}", model_manager.model_id, request.model_id,)
        model_manager.load_model(request.model_id)


    model = model_manager.model

    if model is None:
        raise RuntimeError(
            "Cannot synthesize: model is not loaded (call /v1/model/reload)."
        )

    voice = model_manager.voice_library.get(request.voice_id)

    # Per-request exaggeration/cfg_weight (from the request body) take
    # precedence when the caller supplied a voice_id-less request; when a
    # known voice_id is given, its stored params are used so a cloned
    # voice's tuned settings aren't silently overridden by request
    # defaults the caller never actually set.
    exaggeration = request.exaggeration if request.voice_id is None else voice.exaggeration

    cfg_weight = request.cfg_weight if request.voice_id is None else voice.cfg_weight

    audio_prompt_path, temp_file = resolve_audio_prompt_path(
        request.audio_prompt, voice.audio_path
    )

    text = request.text.strip()

    chunks = split_into_chunks(text) if len(text) > _CHUNK_THRESHOLD_CHARS else [text]

    logger.info(
        "Synthesizing {} chars in {} chunk(s) (voice='{}', exaggeration={}, cfg_weight={}, ad_hoc_prompt={})",
        len(text),
        len(chunks),
        voice.id,
        exaggeration,
        cfg_weight,
        request.audio_prompt is not None,
    )

    start = time.perf_counter()

    try:

        audio_pieces = [
            _generate_single(
                model,
                chunk_text,
                request.temperature,
                exaggeration,
                cfg_weight,
                audio_prompt_path,
            )
            for chunk_text in chunks
        ]

    except Exception as e:

        logger.error("Chatterbox inference failed: {}", e)

        raise

    finally:

        if temp_file is not None:

            temp_file.unlink(missing_ok=True)

    elapsed_ms = (time.perf_counter() - start) * 1000

    audio = np.concatenate(audio_pieces) if len(audio_pieces) > 1 else audio_pieces[0]

    buffer = io.BytesIO()

    sf.write(buffer, audio, model.sr, format="WAV")

    wav_bytes = buffer.getvalue()

    duration = len(audio) / model.sr

    logger.info(
        "Synthesis complete: {:.1f}ms for {:.2f}s of audio (rtf={:.3f})",
        elapsed_ms,
        duration,
        (elapsed_ms / 1000) / duration if duration > 0 else float("inf"),
    )

    return ServeTTSResponse(
        audio=wav_bytes,
        sample_rate=model.sr,
        duration=duration,
    )