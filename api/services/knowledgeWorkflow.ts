import { extractText } from "./fileProcessor";
import { createChunks } from "./chunker";
import { generateEmbedding } from "./embeddingService";
import { pythonRuntimeClient } from "./python-runtime";

export interface DocumentAnalysisResult {
    summary: string;
    entities: {
        people: string[];
        organizations: string[];
        locations: string[];
        dates: string[];
        technologies: string[];
    };
    keywords: string[];
    topics: string[];
    metadata: {
        language: string;
        documentType: string;
        confidence: number;
    };
}

export interface KnowledgeWorkflowResult {
    text: string;
    analysis: DocumentAnalysisResult;
    chunks: string[];
    embeddings: number[][];
    metadata: {
        mimeType: string;
        characters: number;
        words: number;
        extractedAt: Date;
    };
}

function emptyAnalysis(): DocumentAnalysisResult {
    return {
        summary: "",
        entities: {
            people: [],
            organizations: [],
            locations: [],
            dates: [],
            technologies: [],
        },
        keywords: [],
        topics: [],
        metadata: {
            language: "Unknown",
            documentType: "Unknown",
            confidence: 0,
        },
    };
}

// Runs the LangGraph-backed document_analysis tool (ingestion ->
// summarizer -> extractor -> synthesizer, see
// python-runtime/app/tools/document_analysis/graph.py) via the same
// pythonRuntimeClient bridge every other Python tool uses (health-checks
// and lazily starts the runtime on 127.0.0.1:8002, then POSTs /execute).
// Previously this function pointed at a nonexistent
// 127.0.0.1:8000/document/analyze endpoint and was never imported anywhere;
// it now mirrors documentProcessor.ts's extraction/chunking/embedding
// pipeline and additionally runs the analysis tool.
export async function knowledgeWorkflow(
    filePath: string,
    mimeType: string
): Promise<KnowledgeWorkflowResult> {

    const text = await extractText(filePath, mimeType);

    if (!text.trim()) {
        return {
            text: "",
            analysis: emptyAnalysis(),
            chunks: [],
            embeddings: [],
            metadata: {
                mimeType,
                characters: 0,
                words: 0,
                extractedAt: new Date(),
            },
        };
    }

    const execResult = await pythonRuntimeClient.execute(
        "document_analysis",
        { text }
    );

    if (!execResult?.success) {
        throw new Error(
            execResult?.error || "Document analysis failed."
        );
    }

    const raw = (execResult as any).result?.analysis
        ?? (execResult as any).analysis
        ?? {};

    const analysis: DocumentAnalysisResult = {
        summary: raw.summary ?? "",
        entities: {
            people: raw.entities?.people ?? [],
            organizations: raw.entities?.organizations ?? [],
            locations: raw.entities?.locations ?? [],
            dates: raw.entities?.dates ?? [],
            technologies: raw.entities?.technologies ?? [],
        },
        keywords: raw.keywords ?? [],
        topics: raw.topics ?? [],
        metadata: {
            language: raw.metadata?.language ?? "Unknown",
            documentType: raw.metadata?.document_type ?? "Unknown",
            confidence: raw.metadata?.confidence ?? 0,
        },
    };

    const chunks = createChunks(text);

    const embeddings: number[][] = [];

    for (const chunk of chunks) {
        embeddings.push(
            await generateEmbedding(chunk)
        );
    }

    return {
        text,
        analysis,
        chunks,
        embeddings,
        metadata: {
            mimeType,
            characters: text.length,
            words: text.trim().split(/\s+/).length,
            extractedAt: new Date(),
        },
    };
}
