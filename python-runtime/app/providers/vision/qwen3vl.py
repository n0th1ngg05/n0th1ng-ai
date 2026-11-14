import os
import ollama

from app.providers.vision.base import VisionProvider
from app.tools.vision.models import VisionResponse


class Qwen3VLProvider(VisionProvider):

    name = "qwen3_vl"

    def __init__(self):

        self.model = os.getenv("VISION_QWEN_MODEL", "qwen3-vl:4b")
        host = os.getenv("OLLAMA_HOST_URL", "http://127.0.0.1:11434")

        self.client = ollama.Client(host=host)

    async def initialize(self):

        print("[Qwen3-VL] Ready")

    async def analyze(
        self,
        image_path: str,
        prompt: str | None = None
    ) -> VisionResponse:

        if prompt is None:
            prompt = "Describe this image in detail."

        try:

            response = self.client.chat(

                model=self.model,
                

                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [image_path]
                    }
                ],

                options ={
                    "temperature": 0.2,
                    "num_ctx": 8219
                }

            )

            return VisionResponse(

                success=True,

                text=response["message"]["content"]

            ).model_dump()

        except Exception as e:

            return VisionResponse(

                success=False,

                text="",

                metadata={
                    "error": str(e)
                }

            ).model_dump()

    async def shutdown(self):

        print("[Qwen3-VL] Shutdown")