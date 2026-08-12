import logging
import time

from app.tools.base import BaseTool

from .graph import get_graph

logger = logging.getLogger("document_analysis")


class DocumentAnalysisTool(BaseTool):

    name = "document_analysis"

    def __init__(self):
        self.graph = get_graph()

    async def initialize(self):
        logger.info("[document_analysis] Tool initialized, pipeline ready.")

    async def execute(self, payload: dict):
        """Non-streaming entry point for /execute (direct local calls and
        remote-worker dispatch via the cluster). No live token relay here;
        use /analyze for live progress + thinking tokens."""

        start = time.perf_counter()
        text = payload.get("text")

        logger.info("[document_analysis] execute() called | input_chars=%d", len(text) if text else 0)

        if not text:
            logger.error("[document_analysis] execute() called with no 'text'.")
            return {"success": False, "error": "Missing 'text' in payload."}

        try:
            final_state = await self.graph.ainvoke({"text": text})
            result = final_state.get("result", {})

            if not result.get("success", False):
                error_msg = result.get("error", "Document analysis returned no result.")
                logger.error("[document_analysis] execute() failed: %s", error_msg)
                return {"success": False, "error": error_msg}

            elapsed = round(time.perf_counter() - start, 4)
            logger.info("[document_analysis] execute() succeeded in %.4fs", elapsed)
            return {"success": True, "analysis": result, "execution_time": elapsed}

        except Exception as e:
            logger.exception("[document_analysis] execute() raised: %s", e)
            return {"success": False, "error": str(e)}

    async def shutdown(self):
        logger.info("[document_analysis] Tool shutdown.")
