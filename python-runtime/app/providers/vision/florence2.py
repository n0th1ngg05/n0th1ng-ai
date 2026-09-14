from transformers import AutoModelForCausalLM, AutoProcessor
from PIL import Image
import torch

from app.providers.vision.base import VisionProvider
from app.tools.vision.models import VisionResponse


class Florence2Provider(VisionProvider):

    name = "florence2"

    def __init__(self):

        self.processor = None
        self.model = None
        self.device = "cpu"

    async def initialize(self):

        print("[Florence-2] Loading...")

        self.processor = AutoProcessor.from_pretrained(
            "microsoft/Florence-2-base"
        )

        self.model = AutoModelForCausalLM.from_pretrained(
            "microsoft/Florence-2-base",
            trust_remote_code=True
        ).to(self.device)

        print("[Florence-2] Ready")

    async def analyze(self, image_path, prompt=None):

        if prompt is None:
            prompt = "<MORE_DETAILED_CAPTION>"

        image = Image.open(image_path).convert("RGB")

        inputs = self.processor(
            text=prompt,
            images=image,
            return_tensors="pt"
        )

        outputs = self.model.generate(
            **inputs,
            max_new_tokens=1024
        )

        text = self.processor.batch_decode(
            outputs,
            skip_special_tokens=False
        )[0]

        return VisionResponse(
            success=True,
            text=text
        ).model_dump()

    async def shutdown(self):

        self.model = None
        self.processor = None