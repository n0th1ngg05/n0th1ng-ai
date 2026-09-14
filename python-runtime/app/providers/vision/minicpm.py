import ollama

from app.providers.vision.base import VisionProvider
from app.tools.vision.models import VisionResponse


class MiniCPMVProvider(VisionProvider):

    name = "minicpm"

    def __init__(self):

        self.model = "minicpm-v4.6:1b"

        self.client = ollama.Client(host="http://127.0.0.1:11434")

    async def initialize(self):

        print("[MiniCPM-V] Ready")

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

        print("[MiniCPM-V] Shutdown")