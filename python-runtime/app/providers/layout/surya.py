from PIL import Image

from app.providers.layout.base import LayoutProvider
from app.providers.ocr.surya import get_shared_foundation


class SuryaLayoutProvider(LayoutProvider):

    name = "surya"

    def __init__(self):

        self.foundation = None
        self.predictor = None

    async def initialize(self):

        print("[Surya Layout] Registered (lazy model loading enabled)")

    def _ensure_loaded(self):

        if self.predictor is not None:
            return

        from surya.layout import LayoutPredictor

        print("[Surya Layout] Loading...")

        self.foundation = get_shared_foundation()

        self.predictor = LayoutPredictor(
            self.foundation
        )

        print("[Surya Layout] Ready")

    async def analyze(self, image_path: str):

        self._ensure_loaded()

        image = Image.open(image_path).convert("RGB")

        result = self.predictor(

            images=[image]

        )

        return result

    async def shutdown(self):

        self.predictor = None
        self.foundation = None

        print("[Surya Layout] Shutdown")