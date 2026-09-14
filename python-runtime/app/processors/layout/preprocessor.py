from app.processors.ocr.preprocessor import OCRPreprocessor


class LayoutPreprocessor:

    @staticmethod
    def prepare(image_path: str):

        image = OCRPreprocessor.load(image_path)

        image = OCRPreprocessor.resize(image)

        return image