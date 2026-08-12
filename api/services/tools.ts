// ─────────────────────────────────────────────────────────────────────────────
// tools.ts  –  Single source of truth for every tool the agent can call.
//
// DESIGN RULES
//   • description  → used verbatim in the selector prompt; keep it sharp and
//                    unambiguous for a small (0.6-b) routing model.
//   • triggers     → keywords / phrases that are STRONG signals for this tool.
//   • never        → phrases that must NOT trigger this tool (negative examples).
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  triggers: string[];
  never?: string[];
  parameters?: Record<string, string>;
  /** Can this tool run in parallel with others in the same iteration? */
  parallel?: boolean;
}

export const availableTools: ToolDef[] = [

  // ── KNOWLEDGE / FILES ──────────────────────────────────────────────────────

  {
    name: "knowledge_search",
    description:
      "Search the USER'S OWN uploaded files, indexed documents, project notes, " +
      "and local knowledge base. Use ONLY when the answer might live inside " +
      "documents the user has already uploaded to this system.",
    triggers: [
      "my documents", "my files", "my notes", "my knowledge base",
      "uploaded file", "in my project", "find in my",
    ],
    never: [
      "latest", "current", "news", "specs of", "what is", "who is",
      "internet", "search the web",
    ],
    parameters: { query: "string" },
    parallel: true,
  },

  {
    name: "file_search",
    description:
      "Search INSIDE a specific file that the user has uploaded (e.g. search " +
      "inside a PDF, CSV, or text file by name). Different from knowledge_search " +
      "which searches across all indexed content.",
    triggers: [
      "in this file", "in that file", "inside the file", "search the pdf",
      "search the csv", "find in the document",
    ],
    never: ["internet", "web", "latest", "current"],
    parameters: { query: "string" },
    parallel: true,
  },

  // ── INTERNET / RESEARCH ────────────────────────────────────────────────────

  {
    name: "internet_search",
    description:
      "Quick single-query web search. Use for fast factual lookups, recent news, " +
      "current prices, or any information not stored locally. NOT for deep research.",
    triggers: [
      "search the web", "look up", "current", "latest news", "what is the price",
      "recent", "today", "right now",
    ],
    never: ["research", "compare", "analyze", "investigate", "deep dive"],
    parameters: { query: "string" },
    parallel: true,
  },

  {
    name: "research_query",
    description:
      "DEEP multi-source internet research. Use when the user says 'research', " +
      "'investigate', 'analyze', 'compare', 'comprehensive', 'detailed breakdown', " +
      "or asks for specs / reviews / comparisons of products, technologies, or topics. " +
      "Returns aggregated information from multiple sources.",
    triggers: [
      "research", "investigate", "analyze", "compare", "deep dive",
      "comprehensive", "detailed", "breakdown", "specifications", "specs",
      "review", "how does X work", "tell me about", "explain",
    ],
    never: ["my files", "uploaded", "my notes"],
    parameters: { query: "string" },
    parallel: false,
  },

  {
    name: "url_reader",
    description:
      "Fetch and extract the full content of a specific URL provided by the user.",
    triggers: ["http://", "https://", "this url", "open this link", "read this page"],
    parameters: { url: "string" },
    parallel: true,
  },

  // ── VISION / DOCUMENT (LOCAL PYTHON RUNTIME) ────────────────────────────────
  // These four tools all take an image or PDF as input and are easily confused
  // by a small routing model. Pick EXACTLY ONE per request:
  //   literal text extraction only    → local_vision_ocr
  //   structure/layout detection only → layout_analyzer
  //   input is a PDF file             → marker_pdf_pipeline
  //   describing / understanding / Q&A → local_vision_analyzer

  {
    name: "local_vision_ocr",
    description:
      "Extract raw TEXT from an image using Surya OCR. Use ONLY when the user " +
      "wants the literal text content pulled out of an image — a screenshot, " +
      "scanned document, receipt, form, ID card, handwritten note, or book page. " +
      "Returns extracted text, per-line confidence, and bounding boxes. " +
      "Does NOT describe the image and does NOT analyze layout or structure — " +
      "it only reads text characters.",
    triggers: [
      "extract the text", "ocr this", "read the text in", "text in this image",
      "transcribe this image", "what does this say", "read this receipt",
      "read this handwriting", "scan this document", "extract text from screenshot",
      "read this id", "read this form",
    ],
    never: [
      "describe this image", "what is in this image", "what does this image show",
      "analyze the layout", "document structure", "pdf", "explain this diagram",
      "explain this chart", "what objects", "describe the scene",
    ],
    parameters: { image_path: "string" },
    parallel: true,
  },

  {
    name: "layout_analyzer",
    description:
      "Analyze the STRUCTURE of a document image using Surya Layout — detects " +
      "section headers, paragraphs, tables, figures, page regions, captions, and " +
      "overall document structure. Use ONLY when the user wants to know HOW an " +
      "image/page is organized or laid out — not what the text says, and not a " +
      "general visual description.",
    triggers: [
      "analyze the layout", "document structure", "detect tables in this image",
      "page layout", "find the sections", "structure of this page",
      "identify the regions", "where are the tables", "detect headings",
    ],
    never: [
      "extract the text", "ocr this", "what does this say", "describe this image",
      "what is in this image", "explain this diagram", "explain this chart", "pdf",
    ],
    parameters: { image_path: "string" },
    parallel: true,
  },

  {
    name: "marker_pdf_pipeline",
    description:
      "Parse a PDF FILE (not an image) using Marker — extracts markdown, headings, " +
      "document structure, tables, images, metadata, and table of contents from a " +
      "PDF. Use ONLY when the input is a PDF document. If the input is an image " +
      "file, use local_vision_ocr, layout_analyzer, or local_vision_analyzer instead.",
    triggers: [
      "parse this pdf", "extract from pdf", "convert pdf to markdown",
      "read this pdf", "pdf table of contents", "extract tables from pdf",
      "pdf structure", "pdf metadata",
    ],
    never: [
      "image", "screenshot", "photo", "picture", "describe this image",
      "ocr this", "extract the text from this image",
    ],
    parameters: { pdf_path: "string" },
    parallel: true,
  },

  {
    name: "local_vision_analyzer",
    description:
      "General-purpose visual UNDERSTANDING using a local VLM (qwen3-vl:4b, " +
      "falls back to minicpm-v4.6:1b). Use when the user wants an image DESCRIBED " +
      "or EXPLAINED, or asks a visual question about it — describing images, " +
      "analyzing screenshots, explaining diagrams/charts/graphs, identifying " +
      "objects, scene understanding, or answering 'what is happening in this " +
      "image'. Do NOT use this for pulling out literal text (use local_vision_ocr) " +
      "or for detecting document structure (use layout_analyzer).",
    triggers: [
      "describe this image", "what is in this image", "what does this image show",
      "explain this diagram", "explain this chart", "explain this graph",
      "what objects are in", "describe the scene", "analyze this screenshot",
      "what is happening in this image", "identify this",
    ],
    never: [
      "extract the text", "ocr this", "read the text in", "transcribe",
      "document structure", "analyze the layout", "table of contents",
    ],
    parameters: { image_path: "string", prompt: "string" },
    parallel: true,
  },

  // ── MEMORY ─────────────────────────────────────────────────────────────────

  {
    name: "memory_store",
    description:
      "Save NEW information to long-term memory so it persists across sessions. " +
      "Triggered by: 'remember that', 'save this', 'keep this in mind', " +
      "'I want you to know', 'note that', 'memorize', 'don't forget'. " +
      "ALWAYS use this when user explicitly asks you to remember something.",
    triggers: [
      "remember that", "remember this", "save this", "keep in mind",
      "I want you to know", "note that", "memorize", "don't forget",
      "I am interested in", "I like", "I prefer", "store this",
    ],
    never: ["what do you remember", "do you know", "recall", "forget", "delete", "update"],
    parameters: {
      category: "string  // e.g. Preferences, Goals, Personal, Work",
      key: "string       // short descriptive key, e.g. 'interested_in_rtx5090'",
      value: "string     // the full value to remember",
    },
    parallel: true,
  },

  {
    name: "memory_search",
    description:
      "Look up previously stored memories. Use when user ASKS what you remember " +
      "about them, their preferences, past conversations, or stored facts.",
    triggers: [
      "what do you remember", "do you know my", "what is my",
      "what have I told you", "recall", "look up my", "check my preferences",
    ],
    never: ["remember that", "save", "forget", "delete"],
    parameters: { query: "string" },
    parallel: true,
  },

  {
    name: "memory_update",
    description:
      "Update an EXISTING memory with a new value. Use when user says something " +
      "changed, e.g. 'my X is now Y', 'update my', 'I switched to', 'I now use'.",
    triggers: [
      "update my", "change my", "my X is now", "I switched to",
      "I now use", "replace my", "correct that",
    ],
    never: ["remember that", "save", "forget", "delete", "search"],
    parameters: {
      key: "string   // existing memory key to update",
      value: "string // new value",
    },
    parallel: false,
  },

  {
    name: "memory_delete",
    description:
      "Delete a specific memory. Triggered by: 'forget', 'delete', 'remove', " +
      "'erase', 'clear that memory'.",
    triggers: ["forget", "delete memory", "remove memory", "erase", "clear that"],
    never: ["remember", "save", "search", "update"],
    parameters: { key: "string" },
    parallel: false,
  },

  // ── SYSTEM / COMPUTE ───────────────────────────────────────────────────────

  {
    name: "scientific_calculator",
    description:
      "Evaluate mathematical expressions, equations, unit conversions, or " +
      "percentages. Input must be a valid JS-evaluable math expression.",
    triggers: [
      "calculate", "compute", "math", "equation", "convert", "percent",
      "what is X + Y", "how many", "solve",
    ],
    parameters: { expression: "string  // valid JS math expression" },
    parallel: true,
  },

  {
    name: "system_monitor",
    description:
      "Get real-time system stats: CPU, RAM, GPU, VRAM, storage, temperature. " +
      "Use when user asks about their hardware performance or resource usage.",
    triggers: [
      "cpu usage", "ram usage", "gpu usage", "vram", "memory usage",
      "system stats", "hardware stats", "temperature", "disk usage",
    ],
    parallel: true,
  },

  {
    name: "model_manager",
    description:
      "List or inspect Ollama models that are INSTALLED on disk (available, " +
      "not necessarily running).",
    triggers: [
      "installed models", "available models", "list models", "what models",
      "model sizes", "model info",
    ],
    never: ["running", "loaded", "active", "in memory"],
    parallel: true,
  },

  {
    name: "ollama_control",
    description:
      "List Ollama models currently RUNNING or LOADED in memory. Different from " +
      "model_manager which shows installed (on-disk) models.",
    triggers: [
      "running models", "loaded models", "active models", "models in memory",
      "what is running", "currently loaded",
    ],
    never: ["installed", "available on disk"],
    parallel: true,
  },

  {
    name: "sql_query",
    description:
      "Query the AI workstation's own database for stored records: conversation " +
      "history, message counts, stored files list, generated images, statistics. " +
      "NOT for external data.",
    triggers: [
      "conversation history", "how many messages", "stored files", "database",
      "chat history", "how many X are stored", "database stats",
    ],
    never: ["internet", "web", "current", "latest"],
    parameters: { query: "string  // natural language query" },
    parallel: true,
  },

];

// ── Helper: get tool by name ──────────────────────────────────────────────────
export function getToolDef(name: string): ToolDef | undefined {
  return availableTools.find(t => t.name === name);
}

// ── Helper: compact list for the selector prompt ──────────────────────────────
export function toolsForPrompt(): string {
  return availableTools
    .map(t => {
      const params = t.parameters
        ? "\n  args: " + JSON.stringify(Object.keys(t.parameters))
        : "";
      return `• ${t.name}${params}\n  → ${t.description}`;
    })
    .join("\n\n");
}

export function toolsForRouterPrompt(): string {
  return availableTools
    .map(t => {
      const lines: string[] = [`### ${t.name}`, t.description];

      if (t.parameters && Object.keys(t.parameters).length > 0) {
        lines.push(
          "arguments: " +
            JSON.stringify(t.parameters, null, 0).replace(/,/g, ", ")
        );
      } else {
        lines.push("arguments: {} (this tool takes no arguments)");
      }

      if (t.triggers.length > 0) {
        lines.push("use when the request mentions: " + t.triggers.join(", "));
      }

      if (t.never && t.never.length > 0) {
        lines.push(
          "do NOT pick this tool just because the request mentions: " +
            t.never.join(", ")
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

// ── Native function-calling schema (Ollama /api/chat `tools` param) ──────────
//
// `ToolDef.parameters` is a loose `{ argName: "type  // comment" }` map meant
// for humans reading the prompt-style router. Native tool-calling needs real
// JSON Schema, so this strips inline comments, maps to JSON Schema primitive
// types, and treats every declared parameter as required (matches the
// existing behavior in toolExecutor.ts, where every declared arg is checked
// via requireArg).

const JSON_SCHEMA_TYPES = new Set([
  "string", "number", "integer", "boolean", "array", "object",
]);

function parseParamType(raw: string): { type: string; description?: string } {
  const commentIdx = raw.indexOf("//");
  const typePart = (commentIdx === -1 ? raw : raw.slice(0, commentIdx)).trim();
  const comment = commentIdx === -1 ? undefined : raw.slice(commentIdx + 2).trim();

  const type = JSON_SCHEMA_TYPES.has(typePart) ? typePart : "string";

  return comment ? { type, description: comment } : { type };
}

export interface OllamaToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
  };
}

function shortDescription(name: string): string {

    switch (name) {

        case "knowledge_search":
            return "Search user knowledge.";

        case "file_search":
            return "Search one uploaded file.";

        case "internet_search":
            return "Search the internet.";

        case "research_query":
            return "Deep internet research.";

        case "url_reader":
            return "Read webpage.";

        case "local_vision_ocr":
            return "Extract text from image.";

        case "layout_analyzer":
            return "Analyze document layout.";

        case "marker_pdf_pipeline":
            return "Read PDF.";

        case "local_vision_analyzer":
            return "Describe or answer questions about an image.";

        case "memory_store":
            return "Store memory.";

        case "memory_search":
            return "Search memory.";

        case "memory_update":
            return "Update memory.";

        case "memory_delete":
            return "Delete memory.";

        case "scientific_calculator":
            return "Calculate expression.";

        case "system_monitor":
            return "System statistics.";

        case "model_manager":
            return "Installed models.";

        case "ollama_control":
            return "Running models.";

        case "sql_query":
            return "Database statistics.";

        default:
            return "";
    }

}

export function toolsForNativeSchema(): OllamaToolSchema[] {
  return availableTools.map(t => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];

    for (const [argName, argSpec] of Object.entries(t.parameters ?? {})) {
      properties[argName] = parseParamType(argSpec);
      required.push(argName);
    }

    // Fold trigger/never hints into the description since native tool-calling
    // has no equivalent field — this is the model's only signal for when
    // (not) to pick this tool.
    let description = shortDescription(t.name);

    return {
      type: "function" as const,
      function: {
        name: t.name,
        description,
        parameters: {
          type: "object" as const,
          properties,
          required,
        },
      },
    };
  });
}