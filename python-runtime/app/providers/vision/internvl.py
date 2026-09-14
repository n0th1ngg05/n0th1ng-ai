import torch
from PIL import Image
from transformers import AutoModel, AutoTokenizer

from app.providers.vision.base import VisionProvider
from app.tools.vision.models import VisionResponse


class InternVLProvider(VisionProvider):

    name = "internvl"

    def __init__(self):

        self.model = None
        self.tokenizer = None
        self.device = "cpu"

    async def initialize(self):

        print("[InternVL] Loading...")

        self.model = AutoModel.from_pretrained(

            "OpenGVLab/InternVL3-2B",

            trust_remote_code=True,

            torch_dtype=torch.float32

        )

        self.tokenizer = AutoTokenizer.from_pretrained(

            "OpenGVLab/InternVL3-2B",

            trust_remote_code=True

        )

        print("[InternVL] Ready")

    async def analyze(self, image_path, prompt=None):

        if prompt is None:
            prompt = "Describe this image."

        image = Image.open(image_path).convert("RGB")

        response = self.model.chat(

            self.tokenizer,

            image,

            prompt

        )

        return VisionResponse(

            success=True,

            text=response

        ).model_dump()

    async def shutdown(self):

        self.model = None
        self.tokenizer = None