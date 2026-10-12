from PIL import Image

from app.providers.ocr.base import OCRProvider

_shared_foundation = None


def get_shared_foundation():
    global _shared_foundation
    if _shared_foundation is None:
        from surya.foundation import FoundationPredictor
        print("[Surya] Loading shared FoundationPredictor...")
        _shared_foundation = FoundationPredictor()
    return _shared_foundation


def clear_shared_foundation():
    global _shared_foundation
    _shared_foundation = None


class SuryaOCRProvider(OCRProvider):

    name = "surya"

    def __init__(self):

        self.foundation = None
        self.detector = None
        self.recognizer = None

    async def initialize(self):

        print("[Surya OCR] Registered (lazy model loading enabled)")

    def _ensure_loaded(self):

        if self.recognizer is not None and self.detector is not None:
            return

        from surya.detection import DetectionPredictor
        from surya.recognition import RecognitionPredictor

        self.foundation = get_shared_foundation()

        print("[Surya OCR] Loading Detector...")
        self.detector = DetectionPredictor()

        print("[Surya OCR] Loading Recognizer...")
        self.recognizer = RecognitionPredictor(
            self.foundation
        )

        print("[Surya OCR] Ready")

    async def recognize(
        self,
        image_path: str
    ):

        self._ensure_loaded()

        image = Image.open(image_path).convert("RGB")

        result = self.recognizer(

            images=[image],

            det_predictor=self.detector

        )

        return result

    async def shutdown(self):

        self.recognizer = None
        self.detector = None
        self.foundation = None
        clear_shared_foundation()

        print("[Surya OCR] Shutdown")