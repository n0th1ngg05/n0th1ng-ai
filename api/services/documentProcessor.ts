import { extractText } from "./fileProcessor";
import { createChunks } from "./chunker";
import { generateEmbedding } from "./embeddingService";

export interface ProcessedDocument {
    text: string;
    chunks: string[];
    embeddings: number[][];
    metadata: {
        mimeType: string;
        characters: number;
        words: number;
        extractedAt: Date;
    };
}

// Image MIME types are handled by the dedicated vision-tool pipeline
// (local_vision_ocr, layout_analyzer, local_vision_analyzer) at chat time,
// driven by the router's decision about what the user actually asked for.
// Running generic OCR (tesseract.js) on every uploaded image at UPLOAD time —
// before any message or router decision exists — produces garbage text for
// non-document photos (tesseract hallucinating glyphs out of textures, bark,
// fur, etc.), which then gets embedded, chunked, and silently injected into
// every future prompt in the conversation as "ATTACHMENT CONTEXT", regardless
// of what the user asks. Images are therefore skipped here entirely.
const IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/bmp",
    "image/tiff",
]);

export async function processDocument(
    filePath: string,
    mimeType: string
): Promise<ProcessedDocument> {
    const isImage = IMAGE_MIME_TYPES.has(mimeType);
    const text = isImage
        ? ""
        : await extractText(
            filePath,
            mimeType
        );
    if (isImage) {
        console.log(
            "[DOCUMENT] Skipping text extraction for image MIME type " +
            `(${mimeType}) — handled by vision tools at chat time instead.`
        );
    }
    const chunks =
        text.trim().length > 0
            ? createChunks(text)
            : [];
    const embeddings: number[][] = [];
    for (const chunk of chunks) {
        embeddings.push(
            await generateEmbedding(chunk)
        );
    }
    return {
        text,
        chunks,
        embeddings,
        metadata: {
            mimeType,
            characters: text.length,
            words:
                text.trim().length === 0
                    ? 0
                    : text.trim().split(/\s+/).length,
            extractedAt: new Date(),
        },
    };
}