from app.providers.ocr.base import OCRProvider


class PaddleOCRProvider(OCRProvider):

    name = "paddle"

    def __init__(self):
        self.model = None

    async def initialize(self):

        print("[PaddleOCR] Loading models...")

        try:
            from paddleocr import PaddleOCR
        except Exception as e:
            print(f"[PaddleOCR] Error importing paddleocr: {e}")
            raise e

        self.model = PaddleOCR(
            text_detection_model_name="PP-OCRv5_server_det",
            text_recognition_model_name="PP-OCRv5_server_rec"
        )

        print("[PaddleOCR] Ready")

    async def recognize(self, image):

        result = list(
            self.model.predict(input=image)
        )

        print("\n================ OCR RAW ================\n")

        for page in result:

            print(page)

            print("----------------------------------------")

            print(page.get("rec_texts"))

            print(page.get("rec_scores"))

            print(page.get("rec_polys"))

        print("\n=========================================\n")

        return result

    async def shutdown(self):

        self.model = None

        print("[PaddleOCR] Shutdown")