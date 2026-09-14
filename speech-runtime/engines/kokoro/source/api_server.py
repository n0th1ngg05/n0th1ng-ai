"""Standalone Kokoro TTS engine HTTP server.

Mirrors the /v1/health and /v1/tts contract of the chatterbox/fishspeech
engines so providers/kokoro.py can talk to it identically. Launched
independently by the user via ../launcher.py — never started automatically
by the main speech-runtime.
"""
from __future__ import annotations

import argparse
import io
import sys
import time

import numpy as np

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from loguru import logger
from tqdm import tqdm
import soundfile as sf
import torch
import uvicorn

app = FastAPI(title="Kokoro Engine")

_pipeline = None
_device = "cpu"
_request_count = 0

# Match chatterbox/fishspeech's loguru format exactly:
# 2026-07-14 23:49:13.461 | INFO | __main__:<module>:121 - message
logger.remove()
logger.add(
    sys.stderr,
    format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
           "<level>{level: <8}</level> | "
           "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
           "<level>{message}</level>",
    level="INFO",
    colorize=True,
)


class TTSRequestBody(BaseModel):
    text: str
    voice_id: str = "af_bella"


@app.get("/v1/health")
async def health():
    return {"status": "ok", "pipeline_loaded": _pipeline is not None, "device": _device}


@app.post("/v1/tts")
async def tts(body: TTSRequestBody):
    global _request_count

    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not loaded")

    _request_count += 1
    request_id = _request_count

    char_count = len(body.text)
    logger.info(
        "Kokoro request #{} ({} chars, voice={})",
        request_id, char_count, body.voice_id,
    )

    start = time.perf_counter()

    generator = _pipeline(body.text, voice=body.voice_id)

    audio_chunks = []
    # Kokoro splits long text into multiple clause-sized chunks internally
    # and yields one audio segment per chunk. Wrapping the generator in
    # tqdm gives the same kind of live per-chunk progress bar you see
    # during chatterbox's warmup sampling, instead of the request just
    # hanging silently until every chunk is done.
    with tqdm(
        desc=f"Synthesizing #{request_id}",
        unit="chunk",
        leave=False,
        bar_format="{desc}: {n_fmt} chunks [{elapsed}, {rate_fmt}]",
    ) as pbar:
        for result in generator:
            audio_chunks.append(result.output.audio.cpu().numpy())
            pbar.update(1)

    if not audio_chunks:
        logger.error("Request #{} produced no audio", request_id)
        raise HTTPException(status_code=500, detail="Kokoro produced no audio")

    audio = audio_chunks[0] if len(audio_chunks) == 1 else np.concatenate(audio_chunks)

    elapsed = time.perf_counter() - start
    audio_duration = len(audio) / 24000.0
    # Real-time factor: how many seconds of audio were generated per
    # second of compute. RTF > 1 means faster than real-time (good).
    rtf = audio_duration / elapsed if elapsed > 0 else 0.0
    chars_per_sec = char_count / elapsed if elapsed > 0 else 0.0

    logger.info(
        "Request #{} done in {:.2f}s | {} chunks | {:.2f}s audio | "
        "RTF={:.2f}x | {:.1f} chars/s",
        request_id, elapsed, len(audio_chunks), audio_duration, rtf, chars_per_sec,
    )

    buffer = io.BytesIO()
    sf.write(buffer, audio, 24000, format="WAV")

    return Response(content=buffer.getvalue(), media_type="audio/wav")


def main():
    global _pipeline, _device

    parser = argparse.ArgumentParser()
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=6103)
    args = parser.parse_args()

    _device = args.device if torch.cuda.is_available() else "cpu"

    logger.info("Starting Kokoro engine (device={}, host={}, port={})", _device, args.host, args.port)

    if _device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        logger.info("GPU: {} ({:.1f} GB VRAM)", gpu_name, vram_gb)
    elif args.device == "cuda":
        logger.warning("--device cuda requested but CUDA is not available — falling back to CPU")

    load_start = time.perf_counter()

    from kokoro import KPipeline
    logger.info("Loading Kokoro-82M pipeline from hexgrad/Kokoro-82M ...")
    _pipeline = KPipeline(repo_id="hexgrad/Kokoro-82M", lang_code="a")

    load_elapsed = time.perf_counter() - load_start
    logger.info("Pipeline loaded in {:.2f}s.", load_elapsed)

    # Warmup: first real inference on Kokoro/CUDA carries one-time
    # compilation/cache-fill overhead. Running one now means the first
    # real request from a user doesn't eat that cost.
    logger.info("Running warmup generation...")
    warmup_start = time.perf_counter()
    try:
        next(_pipeline("Warming up.", voice="af_bella"))
        logger.info("Warmup complete in {:.2f}s.", time.perf_counter() - warmup_start)
    except Exception as exc:
        logger.warning("Warmup generation failed (non-fatal): {}", exc)

    logger.info("Kokoro engine startup complete.")
    logger.info("Uvicorn running on http://{}:{}", args.host, args.port)

    uvicorn.run(app, host=args.host, port=args.port, workers=1, log_level="warning")


if __name__ == "__main__":
    main()