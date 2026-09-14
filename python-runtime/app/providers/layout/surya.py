from PIL import Image

from surya.foundation import FoundationPredictor
from surya.layout import LayoutPredictor

from app.providers.layout.base import LayoutProvider


class SuryaLayoutProvider(LayoutProvider):

    name = "surya"

    def __init__(self):

        self.foundation = None
        self.predictor = None

    async def initialize(self):

        print("[Surya Layout] Loading...")

        self.foundation = FoundationPredictor()

        self.predictor = LayoutPredictor(
            self.foundation
        )

        print("[Surya Layout] Ready")

    async def analyze(self, image_path: str):

        image = Image.open(image_path).convert("RGB")

        result = self.predictor(

            images=[image]

        )

        return result

    async def shutdown(self):

        self.predictor = None
        self.foundation = None

        print("[Surya Layout] Shutdown")