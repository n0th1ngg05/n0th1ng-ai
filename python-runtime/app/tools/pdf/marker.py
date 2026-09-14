import time

from app.managers.pdf_manager import pdf_manager
from app.tools.base import BaseTool


class MarkerPDFTool(BaseTool):

    name = "marker_pdf_pipeline"

    async def initialize(self):

        print("[Marker Tool] Ready")

    async def execute(self, payload: dict):

        start = time.perf_counter()

        file_path = payload.get("file_path")

        if not file_path:

            return {

                "success": False,

                "error": "Missing file_path."

            }

        provider = pdf_manager.current()

        result = await provider.parse(
            file_path
        )

        return {

            "success": True,

            "provider": provider.name,

            "result": result,

            "execution_time": round(
                time.perf_counter() - start,
                4
            )

        }

    async def shutdown(self):

        print("[Marker Tool] Shutdown")