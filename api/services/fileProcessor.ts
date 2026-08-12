import fs from 'fs/promises';
import path from 'path';
import mammoth from 'mammoth';
import { createWorker } from 'tesseract.js';
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

/**
 * Extracts raw text from various document formats.
 * Supported: PDF, TXT, MD, DOCX, JSON, CSV, and common image formats (via OCR).
 */
export async function extractText(filePath: string, mimeType: string): Promise<string> {
    console.log("[EXTRACT] File:", filePath);
    console.log("[EXTRACT] MIME:", mimeType);
    try {
        try {
            await fs.access(filePath);
        } catch {
            console.error(`[FileProcessor] Error: File not found at path: ${filePath}`);
            return '';
        }

        switch (mimeType) {
            case 'text/plain':
            case 'text/markdown':
            case 'application/json':
            case 'text/csv':
                console.log("[EXTRACT] Using plain text parser");
                return await extractPlainText(filePath);

            case 'application/pdf':
                console.log("[EXTRACT] Using PDF parser");
                return await extractPdfText(filePath);

            case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                console.log("[EXTRACT] Using DOCX parser");
                return await extractDocxText(filePath);

            case 'image/png':
            case 'image/jpeg':
            case 'image/jpg':
            case 'image/webp':
            case 'image/bmp':
            case 'image/tiff':
                console.log("[EXTRACT] Using image OCR");
                return await extractImageText(filePath);

            default:
                console.warn(`[FileProcessor] Unsupported MIME type for text extraction: ${mimeType}`);
                return '';
        }
    } catch (error) {
        console.error(`[FileProcessor] General extraction error for ${filePath}:`, error);
        return '';
    }
}

async function extractPlainText(filePath: string): Promise<string> {
    try {
        const text = await fs.readFile(filePath, 'utf-8');
        return text.trim();
    } catch (error) {
        console.error(`[FileProcessor] Error reading plain text file:`, error);
        return '';
    }
}

async function extractPdfText(filePath: string): Promise<string> {
    try {

        console.log("[PDF] Reading:", filePath);

        const dataBuffer = await fs.readFile(filePath);

        console.log("[PDF] Size:", dataBuffer.length);

        const data = await pdfParse(dataBuffer);

        console.log("[PDF] Pages:", data.numpages);
        console.log("[PDF] Characters:", data.text?.length);

        return (data.text || "").trim();

    } catch (error) {

        console.error("[PDF ERROR]", error);

        return "";
    }
}

async function extractDocxText(filePath: string): Promise<string> {
    try {
        const result = await mammoth.extractRawText({ path: filePath });

        if (!result || !result.value) {
            return '';
        }

        if (result.messages && result.messages.length > 0) {
            const warnings = result.messages.filter(m => m.type === 'warning');
            if (warnings.length > 0) {
                 console.warn(`[FileProcessor] Warnings while parsing DOCX ${path.basename(filePath)}:`, warnings);
            }
        }

        return result.value.trim();
    } catch (error) {
        console.error(`[FileProcessor] Error parsing DOCX:`, error);
        return '';
    }
}

/**
 * Extracts text from images via OCR.
 * Requires: npm install tesseract.js
 */
async function extractImageText(filePath: string): Promise<string> {
    try {
        const worker = await createWorker('eng');
        const { data } = await worker.recognize(filePath);
        await worker.terminate();
        return data.text.trim();
    } catch (error) {
        console.error(`[FileProcessor] Error performing OCR on image ${path.basename(filePath)}:`, error);
        return '';
    }
}