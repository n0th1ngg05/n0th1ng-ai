import json
import logging

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.tools.document_analysis.graph import stream_analysis

logger = logging.getLogger("document_analysis")

router = APIRouter()


class AnalyzeRequest(BaseModel):

    text: str


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Maps each node's own failure-message prefix (see graph.py's
# summarizer_node/extraction_node/metadata_node) back to that node's
# name, so an SSE error event attributes the failure to the node that
# actually raised it — not "synthesizer", which always runs last (even
# on failure) just to package the error into a response.
FAILURE_PREFIXES = {
    "Summarization failed:": "summarizer",
    "Extraction failed:": "extractor",
    "Metadata detection failed:": "metadata",
}


def _attribute_failure(error_msg: str, fallback):
    for prefix, node in FAILURE_PREFIXES.items():
        if error_msg.startswith(prefix):
            return node
    return fallback


@router.post("/analyze")
async def analyze_stream(request: AnalyzeRequest):
    """
    POST /analyze — runs the ingestion -> summarizer -> extractor ->
    metadata -> synthesizer LangGraph pipeline and streams:

      event: progress   — once per completed node
        data: {"node": "summarizer", "label": "Summarizing content"}

      event: thinking    — once per raw token streamed live from Ollama
        data: {"node": "summarizer", "token": "..."}

      event: done         — final synthesized payload
        data: {"success": true, "summary": "...", ...}

      event: error        — on failure, with as much detail as is known
        data: {"error": "...", "node": "summarizer" | null}

    See app/tools/document_analysis/graph.py for the node-level logging
    that accompanies every one of these events server-side — check that
    console output first if a run fails partway through, since the SSE
    error event only carries a short human-readable message while the
    server log carries the full exception, raw model output, and timing.
    """

    async def event_generator():

        if not request.text or not request.text.strip():
            logger.warning("[document_analysis] /analyze called with empty text.")
            yield _sse("error", {"error": "Missing 'text' in payload.", "node": None})
            return

        logger.info(
            "[document_analysis] /analyze stream starting | input_chars=%d",
            len(request.text),
        )

        last_node = None

        try:
            async for event in stream_analysis(request.text):

                if event["type"] == "thinking":
                    yield _sse(
                        "thinking",
                        {"node": event["node"], "token": event["token"]},
                    )
                    continue

                if event["type"] == "progress":
                    last_node = event["node"]
                    yield _sse(
                        "progress",
                        {"node": event["node"], "label": event["label"]},
                    )
                    continue

                if event["type"] == "done":
                    result = event["state"].get("result", {})

                    if result.get("success"):
                        logger.info(
                            "[document_analysis] /analyze stream completed successfully."
                        )
                        yield _sse("done", result)
                    else:
                        error_msg = result.get("error", "Analysis failed.")
                        failed_node = _attribute_failure(error_msg, last_node)
                        logger.error(
                            "[document_analysis] /analyze stream ended in failure "
                            "(failed node: %s): %s",
                            failed_node,
                            error_msg,
                        )
                        yield _sse(
                            "error",
                            {"error": error_msg, "node": failed_node},
                        )

        except Exception as e:
            logger.exception(
                "[document_analysis] /analyze stream crashed unexpectedly "
                "(last node: %s): %s",
                last_node,
                e,
            )
            yield _sse("error", {"error": str(e), "node": last_node})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
