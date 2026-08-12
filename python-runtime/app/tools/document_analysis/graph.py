"""
LangGraph document-analysis pipeline:
    ingestion -> summarizer -> extractor -> metadata -> synthesizer -> END

LOGGING: every node logs on entry/exit; every Ollama call logs request
size, HTTP status, timing, and (on JSON-parse failure) the raw text that
failed to parse — check this console output first if a run fails partway
through. THINKING STREAM: Ollama calls use stream:true; every raw token
is forwarded live via the `_on_token` state callback so a caller can
relay live model output, not just node-start/node-end markers.
"""

import json
import logging
import time
import asyncio

import httpx

from typing import AsyncIterator, Awaitable, Callable, Optional

from langgraph.graph import StateGraph, END

from .state import DocumentAnalysisState
from .prompts import SUMMARY_PROMPT, EXTRACTION_PROMPT, METADATA_PROMPT

logger = logging.getLogger("document_analysis")

OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/chat"
MODEL = "lfm2.5:8b"

TokenCallback = Optional[Callable[[str, str], Awaitable[None]]]


def _preview(text: str, limit: int = 400) -> str:
    text = text or ""
    return text if len(text) <= limit else f"{text[:limit]}... [truncated, {len(text)} chars]"


def _extract_json(content: str) -> dict:
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        logger.warning("[document_analysis] Direct JSON parse failed (%s). Raw: %s", e, _preview(content))
        start, end = content.find("{"), content.rfind("}") + 1
        if start != -1 and end != 0:
            try:
                parsed = json.loads(content[start:end])
                logger.info("[document_analysis] Recovered JSON via brace-slice fallback.")
                return parsed
            except json.JSONDecodeError as e2:
                logger.error("[document_analysis] Brace-slice fallback ALSO failed (%s). Sliced: %s", e2, _preview(content[start:end]))
                raise
        logger.error("[document_analysis] No JSON braces found in model output at all.")
        raise


async def _call_ollama_streaming(node_name: str, system_prompt: str, text: str, on_token: TokenCallback = None) -> dict:
    payload = {
        "model": MODEL, "stream": True, "format": "json",
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": text}],
    }
    logger.info("[document_analysis][%s] -> Ollama request | model=%s | input_chars=%d", node_name, MODEL, len(text))

    started = time.perf_counter()
    assembled = ""
    chunk_count = 0

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", OLLAMA_ENDPOINT, json=payload) as response:
                logger.info("[document_analysis][%s] Ollama HTTP %d, streaming...", node_name, response.status_code)
                if response.status_code != 200:
                    body = await response.aread()
                    logger.error("[document_analysis][%s] Ollama non-200: %d | body=%s", node_name, response.status_code, _preview(body.decode(errors="replace")))
                    response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        logger.warning("[document_analysis][%s] Non-JSON stream line skipped: %s", node_name, _preview(line, 200))
                        continue
                    token = chunk.get("message", {}).get("content", "")
                    if token:
                        assembled += token
                        chunk_count += 1
                        if on_token is not None:
                            await on_token(node_name, token)
                    if chunk.get("done"):
                        break

    except httpx.TimeoutException as e:
        logger.error("[document_analysis][%s] TIMED OUT after %.2fs | %s", node_name, time.perf_counter() - started, e)
        raise
    except httpx.HTTPStatusError as e:
        logger.error("[document_analysis][%s] HTTP error after %.2fs | %s", node_name, time.perf_counter() - started, e)
        raise
    except httpx.ConnectError as e:
        logger.error("[document_analysis][%s] Could not connect to Ollama at %s after %.2fs | %s (is Ollama running? is '%s' pulled?)",
                      node_name, OLLAMA_ENDPOINT, time.perf_counter() - started, e, MODEL)
        raise

    elapsed = time.perf_counter() - started
    logger.info("[document_analysis][%s] <- Ollama complete | %.2fs | %d chunks | %d chars", node_name, elapsed, chunk_count, len(assembled))
    logger.debug("[document_analysis][%s] Raw response: %s", node_name, _preview(assembled, 1000))

    return _extract_json(assembled)


async def ingestion_node(state: DocumentAnalysisState) -> dict:
    logger.info("[document_analysis][ingestion] Node started.")
    text = (state.get("text") or "").strip()
    if not text:
        logger.error("[document_analysis][ingestion] No text provided — aborting.")
        return {"error": "No text to analyze."}
    logger.info("[document_analysis][ingestion] OK | %d chars", len(text))
    return {"text": text}


async def summarizer_node(state: DocumentAnalysisState) -> dict:
    if state.get("error"):
        return {}
    logger.info("[document_analysis][summarizer] Node started.")
    try:
        result = await _call_ollama_streaming("summarizer", SUMMARY_PROMPT, state["text"], state.get("_on_token"))
        summary = result.get("summary", "")
        logger.info("[document_analysis][summarizer] Succeeded | %d chars", len(summary))
        return {"summary": summary}
    except Exception as e:
        logger.exception("[document_analysis][summarizer] FAILED: %s", e)
        return {"error": f"Summarization failed: {e}"}


async def extraction_node(state: DocumentAnalysisState) -> dict:
    if state.get("error"):
        return {}
    logger.info("[document_analysis][extractor] Node started.")
    try:
        result = await _call_ollama_streaming("extractor", EXTRACTION_PROMPT, state["text"], state.get("_on_token"))
        entities, keywords, topics = result.get("entities", {}) or {}, result.get("keywords", []) or [], result.get("topics", []) or []
        logger.info("[document_analysis][extractor] Succeeded | entities=%d keywords=%d topics=%d", len(entities), len(keywords), len(topics))
        return {"entities": entities, "keywords": keywords, "topics": topics}
    except Exception as e:
        logger.exception("[document_analysis][extractor] FAILED: %s", e)
        return {"error": f"Extraction failed: {e}"}


async def metadata_node(state: DocumentAnalysisState) -> dict:
    if state.get("error"):
        return {}
    logger.info("[document_analysis][metadata] Node started.")
    try:
        result = await _call_ollama_streaming("metadata", METADATA_PROMPT, state["text"], state.get("_on_token"))
        logger.info("[document_analysis][metadata] Succeeded | lang=%s type=%s conf=%s", result.get("language"), result.get("document_type"), result.get("confidence"))
        return {
            "language": result.get("language", "unknown"),
            "document_type": result.get("document_type", "unknown"),
            "confidence": float(result.get("confidence", 0.0)),
        }
    except Exception as e:
        logger.exception("[document_analysis][metadata] FAILED: %s", e)
        return {"error": f"Metadata detection failed: {e}"}


async def synthesizer_node(state: DocumentAnalysisState) -> dict:
    logger.info("[document_analysis][synthesizer] Node started.")
    if state.get("error"):
        logger.error("[document_analysis][synthesizer] Upstream error, returning failure payload: %s", state["error"])
        return {"result": {"success": False, "error": state["error"]}}

    defaults = {"people": [], "organizations": [], "locations": [], "dates": [], "technologies": []}
    entities = {**defaults, **(state.get("entities") or {})}
    logger.info("[document_analysis][synthesizer] Succeeded — pipeline complete.")
    return {
        "result": {
            "success": True,
            "text": state.get("text", ""),
            "summary": state.get("summary", ""),
            "entities": entities,
            "keywords": state.get("keywords", []),
            "topics": state.get("topics", []),
            "metadata": {
                "language": state.get("language", "unknown"),
                "document_type": state.get("document_type", "unknown"),
                "confidence": state.get("confidence", 0.0),
            },
        }
    }


def build_graph():
    logger.info("[document_analysis] Compiling LangGraph pipeline...")
    graph = StateGraph(DocumentAnalysisState)
    graph.add_node("ingestion", ingestion_node)
    graph.add_node("summarizer", summarizer_node)
    graph.add_node("extractor", extraction_node)
    graph.add_node("metadata", metadata_node)
    graph.add_node("synthesizer", synthesizer_node)
    graph.set_entry_point("ingestion")
    graph.add_edge("ingestion", "summarizer")
    graph.add_edge("summarizer", "extractor")
    graph.add_edge("extractor", "metadata")
    graph.add_edge("metadata", "synthesizer")
    graph.add_edge("synthesizer", END)
    compiled = graph.compile()
    logger.info("[document_analysis] Pipeline compiled successfully.")
    return compiled


_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph()
    return _compiled_graph


NODE_LABELS = {
    "ingestion": "Ingesting document",
    "summarizer": "Summarizing content",
    "extractor": "Extracting entities",
    "metadata": "Detecting language & type",
    "synthesizer": "Synthesizing result",
}


async def stream_analysis(text: str) -> AsyncIterator[dict]:
    """Yields {"type": "progress"|"thinking"|"done", ...} events live.

    LangGraph's astream() only yields once a node *returns*, so per-token
    events can't come from it directly — they're pushed via an
    asyncio.Queue that every node's Ollama call writes to (through the
    `_on_token` callback in state), while a background task drains
    graph.astream() concurrently.
    """
    graph = get_graph()
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()

    async def on_token(node_name: str, token: str):
        await queue.put({"type": "thinking", "node": node_name, "token": token})

    initial_state: DocumentAnalysisState = {"text": text, "_on_token": on_token}
    final_state_holder: dict = {}

    async def run_graph():
        try:
            async for event in graph.astream(initial_state):
                for node_name, node_output in event.items():
                    node_output = node_output or {}
                    clean = {k: v for k, v in node_output.items() if k != "_on_token"}
                    final_state_holder.update(clean)
                    await queue.put({"type": "progress", "node": node_name, "label": NODE_LABELS.get(node_name, node_name), "state": clean})
        except Exception as e:
            logger.exception("[document_analysis] Graph execution crashed: %s", e)
            final_state_holder["error"] = f"Pipeline crashed: {e}"
            await queue.put({"type": "progress", "node": "synthesizer", "label": NODE_LABELS["synthesizer"],
                              "state": {"result": {"success": False, "error": final_state_holder["error"]}}})
        finally:
            await queue.put(SENTINEL)

    runner_task = asyncio.create_task(run_graph())

    while True:
        item = await queue.get()
        if item is SENTINEL:
            break
        yield item

    await runner_task
    yield {"type": "done", "state": final_state_holder}
