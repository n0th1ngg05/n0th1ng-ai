from __future__ import annotations

import asyncio
import re
from typing import AsyncGenerator

from loguru import logger

from chatterbox_engine.schema import ServeTTSRequest
from chatterbox_engine.utils import resolve_audio_prompt_path, tensor_to_wav_bytes

# Split on sentence-ending punctuation while keeping the delimiter, so each
# chunk is generated (and can start playing) as soon as a natural boundary
# is reached, rather than waiting for the entire response text to finish
# inference before any audio is returned.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")

# A bare regex on ".!?" treats "Mr." or "Dr." as a full sentence boundary,
# producing tiny orphan chunks ("Mr.", "Dr.") that still synthesize but
# sound choppy and waste a generation call on essentially nothing. This
# is a plain, common-abbreviation allowlist rather than a full NLP
# sentence tokenizer — good enough to avoid the common English cases
# without adding a heavyweight dependency (nltk/pysbd) for a TTS chunking
# heuristic that only needs to be "mostly right".
_ABBREVIATIONS = {
    "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.",
    "vs.", "etc.", "e.g.", "i.e.", "st.", "mt.", "ft.",
}


def split_into_chunks(text: str) -> list[str]:

    text = text.strip()

    if not text:
        return []

    raw_sentences = [s.strip() for s in _SENTENCE_BOUNDARY.split(text) if s.strip()]

    if not raw_sentences:
        return [text]

    # Merge any fragment ending in a known abbreviation into the next
    # fragment, since the regex above has already (incorrectly) split
    # there.
    merged: list[str] = []

    for sentence in raw_sentences:

        if merged and merged[-1].rsplit(" ", 1)[-1].lower() in _ABBREVIATIONS:

            merged[-1] = f"{merged[-1]} {sentence}"

        else:

            merged.append(sentence)

    return merged


def _generate_chunk(
    model,
    text: str,
    temperature: float,
    exaggeration: float,
    cfg_weight: float,
    audio_prompt_path: str | None,
) -> bytes:
    """Blocking single-chunk generation + WAV encoding.

    Kept as a plain sync function so it can be passed to
    asyncio.to_thread() as a single unit of work per chunk — running
    model.generate() directly inside the async generator would block the
    event loop for the full duration of every chunk's inference.
    """

    wav = model.generate(
        text,
        temperature=temperature,
        exaggeration=exaggeration,
        cfg_weight=cfg_weight,
        audio_prompt_path=audio_prompt_path,
    )

    wav_bytes, _ = tensor_to_wav_bytes(wav, model.sr)

    return wav_bytes


async def stream_synthesis(
    model_manager,
    request: ServeTTSRequest,
) -> AsyncGenerator[bytes, None]:
    """Yield raw WAV-encoded chunks as they're generated, one per sentence.

    Each chunk is a complete, independently-decodable WAV file rather than
    a raw PCM fragment. This keeps the HTTP transport simple (the client
    can decode and play each chunk as its own audio clip) and leaves room
    for a future websocket transport to instead push raw PCM frames without
    changing how inference itself is chunked — the chunking logic here is
    transport-agnostic.
    """

    model = model_manager.model

    if model is None:
        raise RuntimeError("Cannot stream: model is not loaded.")

    voice = model_manager.voice_library.get(request.voice_id)

    # Resolved once and reused for every chunk in this request — each
    # sentence chunk conditions on the same reference clip, so there's no
    # need to re-spill the ad-hoc prompt to disk per chunk.
    audio_prompt_path, temp_file = resolve_audio_prompt_path(
        request.audio_prompt, voice.audio_path
    )

    chunks = split_into_chunks(request.text)

    logger.info(
        "Streaming synthesis: {} chunk(s) for {} char request",
        len(chunks),
        len(request.text),
    )

    try:

        for index, chunk_text in enumerate(chunks):

            logger.info(
                "Streaming chunk {}/{}: {!r}",
                index + 1,
                len(chunks),
                chunk_text[:60],
            )

            wav_bytes = await asyncio.to_thread(
                _generate_chunk,
                model,
                chunk_text,
                request.temperature,
                request.exaggeration if request.voice_id is None else voice.exaggeration,
                request.cfg_weight if request.voice_id is None else voice.cfg_weight,
                audio_prompt_path,
            )

            yield wav_bytes

    finally:

        if temp_file is not None:

            temp_file.unlink(missing_ok=True)
