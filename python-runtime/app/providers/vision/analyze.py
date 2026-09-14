import time

from app.managers.vision_manager import vision_manager
from app.tools.base import BaseTool


class VisionAnalyzeTool(BaseTool):

    name = "local_vision_analyzer"

    async def initialize(self):

        print("[Vision Tool] Ready")

    async def execute(self, payload: dict):

        start = time.perf_counter()

        image_path = payload.get("image_path")

        prompt = payload.get("prompt")

        if not image_path:

            return {

                "success": False,

                "error": "Missing image_path."

            }

        provider = vision_manager.current()

        result = await provider.analyze(

            image_path=image_path,

            prompt=prompt

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

        print("[Vision Tool] Shutdown")