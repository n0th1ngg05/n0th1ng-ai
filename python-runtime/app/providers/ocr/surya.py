from PIL import Image

from surya.foundation import FoundationPredictor
from surya.detection import DetectionPredictor
from surya.recognition import RecognitionPredictor

from app.providers.ocr.base import OCRProvider


class SuryaOCRProvider(OCRProvider):

    name = "surya"

    def __init__(self):

        self.foundation = None
        self.detector = None
        self.recognizer = None

    async def initialize(self):

        print("[Surya OCR] Loading Foundation...")

        self.foundation = FoundationPredictor()

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

        print("[Surya OCR] Shutdown")