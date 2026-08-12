from app.managers.runtime_manager import runtime_manager
from app.managers.tool_manager import tool_manager

from app.managers.ocr_manager import ocr_manager
from app.providers.ocr.registry import OCR_PROVIDERS

from app.managers.layout_manager import layout_manager
from app.providers.layout.registry import LAYOUT_PROVIDERS

from app.tools.vision.ocr import VisionOCRTool
from app.tools.layout.analyzer import LayoutAnalyzerTool

from app.managers.pdf_manager import pdf_manager
from app.providers.pdf.registry import PDF_PROVIDERS
from app.tools.pdf.marker import MarkerPDFTool

from app.managers.vision_manager import vision_manager
from app.providers.vision.registry import VISION_PROVIDERS
from app.tools.vision.analyze import VisionAnalyzeTool

from app.tools.document_analysis import DocumentAnalysisTool

# Future

#
# from app.managers.docx_manager import docx_manager
# from app.providers.docx.registry import DOCX_PROVIDERS
# from app.tools.docx.reader import SemanticDOCXTool
#
# from app.managers.spreadsheet_manager import spreadsheet_manager
# from app.providers.spreadsheet.registry import SPREADSHEET_PROVIDERS
# from app.tools.spreadsheet.engine import SpreadsheetEngineTool


class Runtime:

    def __init__(self):
        self.initialized = False

    def info(self):
        return{
            "initialized": self.initialized,
            "version": "1.0.0"
        }

    async def initialize(self):

        if self.initialized:
            return

        print("[Runtime] Initializing...")

        #
        # Providers
        #

        for provider in OCR_PROVIDERS:
            await ocr_manager.register(provider)

        for provider in LAYOUT_PROVIDERS:
            await layout_manager.register(provider)

        for provider in PDF_PROVIDERS:
            await pdf_manager.register(provider)

        for provider in VISION_PROVIDERS:
            await vision_manager.register(provider)

        #
        # Managers
        #

        runtime_manager.register(
            ocr_manager.name,
            ocr_manager
        )

        runtime_manager.register(
            layout_manager.name,
            layout_manager
        )

        runtime_manager.register(
            pdf_manager.name,
            pdf_manager
        )

        runtime_manager.register(
            vision_manager.name,
            vision_manager
        )

        runtime_manager.register(
            tool_manager.name,
            tool_manager
        )

        #
        # Tools
        #

        await tool_manager.register(
            VisionOCRTool()
        )

        await tool_manager.register(
            LayoutAnalyzerTool()
        )

        await tool_manager.register(
            MarkerPDFTool()
        )

        await tool_manager.register(
            VisionAnalyzeTool()
        )

        await tool_manager.register(
            DocumentAnalysisTool()
        )

        #
        # Future Tools
        #

        # await tool_manager.register(
        #     MarkerPDFTool()
        # )

        # await tool_manager.register(
        #     SemanticDOCXTool()
        # )

        # await tool_manager.register(
        #     SpreadsheetEngineTool()
        # )

        self.initialized = True

        print("[Runtime] Ready")

    async def shutdown(self):

        print("[Runtime] Shutting down...")

        await ocr_manager.shutdown()
        await layout_manager.shutdown()
        await tool_manager.shutdown()

        self.initialized = False

        print("[Runtime] Stopped")


runtime = Runtime()