from marker.models import create_model_dict
from marker.converters.pdf import PdfConverter

from app.providers.pdf.base import PDFProvider


class MarkerPDFProvider(PDFProvider):

    name = "marker"

    def __init__(self):

        self.artifacts = None
        self.converter = None

    async def initialize(self):

        print("[Marker] Loading artifacts...")

        self.artifacts = create_model_dict()

        print("[Marker] Creating converter...")

        self.converter = PdfConverter(

            artifact_dict=self.artifacts

        )

        print("[Marker] Ready")

    async def parse(
        self,
        file_path: str
    ):

        rendered = self.converter(file_path)

        image_names = []

        for image in rendered.images.keys():
            image_names.append(image)

        return {

            "success": True,

            "markdown": rendered.markdown,

            "metadata": rendered.metadata,

            "images": image_names,

        }

    async def shutdown(self):

        self.converter = None
        self.artifacts = None

        print("[Marker] Shutdown")