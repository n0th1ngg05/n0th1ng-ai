import base64
import tempfile
import os
import time

from app.managers.ocr_manager import ocr_manager
from app.processors.ocr.parser import OCRParser
from app.processors.ocr.postprocessor import OCRPostProcessor
from app.processors.ocr.preprocessor import OCRPreprocessor
from app.tools.base import BaseTool


class VisionOCRTool(BaseTool):

    name = "local_vision_ocr"

    async def initialize(self):

        print("[OCR Tool] Ready")

    async def execute(self, payload: dict):

        start = time.perf_counter()

        image_path = payload.get("image_path")
        image_data = payload.get("image_data")
        image_filename = payload.get("image_filename", "image.jpg")

        tmp_path = None

        # ── Resolve the image: prefer explicit path, fall back to base64 data ──
        if not image_path and image_data:
            try:
                raw = base64.b64decode(image_data)
                suffix = os.path.splitext(image_filename)[1] or ".jpg"
                with tempfile.NamedTemporaryFile(
                    delete=False, suffix=suffix, prefix="ocr_"
                ) as tmp:
                    tmp.write(raw)
                    tmp_path = tmp.name
                image_path = tmp_path
                print(f"[OCR Tool] Decoded base64 image → {tmp_path} ({len(raw)} bytes)")
            except Exception as e:
                return {"success": False, "error": f"Failed to decode image_data: {e}"}

        if not image_path:
            return {
                "success": False,
                "error": "Missing 'image_path' or 'image_data' in payload."
            }

        try:
            provider = ocr_manager.current()

            result = await provider.recognize(image_path)

            parsed = OCRParser.parse(result)

            parsed["text"] = OCRPostProcessor.cleanup(
                parsed["text"]
            )

            return {

                "success": True,

                "provider": provider.name,

                "text": parsed["text"],

                "blocks": parsed["blocks"],

                "execution_time": round(
                    time.perf_counter() - start,
                    4
                )

            }

        finally:
            # Always clean up the temp file even if an exception is raised.
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

    async def shutdown(self):

        print("[OCR Tool] Shutdown")