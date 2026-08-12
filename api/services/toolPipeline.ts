// ───────────────────────────────────────────────────────────────
// Tool Executor
//
// Receives an execution plan produced by toolRouter.ts.
//
// Responsibilities:
//
// • Execute requested tools
// • Run parallel-safe tools concurrently
// • Run sequential tools in order
// • Prevent duplicate execution
// • Return collected results
//
// It DOES NOT:
//
// • Decide whether tools are needed
// • Call an LLM
// • Select tools
// • Build prompts
//
// All planning is handled by toolRouter.ts.
// ───────────────────────────────────────────────────────────────

import { ToolCall } from "./toolSelector";
import { executeTool } from "./toolExecutor";
import { getToolDef } from "./tools";
import path from "path";

// ── Attachment type detection ────────────────────────────────────────────────
// Attachment objects vary in shape depending on the upload path (chat upload
// vs file upload), so we don't assume a `mimetype`/`type` field is always
// present — we fall back to sniffing the extension off `path`/`filename`.
// Note: chatUpload.ts stores the MIME type under `mimeType` (camelCase),
// while other upload paths may use `mimetype` (lowercase) or `type`.

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif",
]);

function getExtension(attachment: any): string {
  const name: string =
    attachment?.filename ??
    attachment?.originalName ??
    attachment?.path ??
    "";
  const match = name.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

function getMimeType(attachment: any): string {
  // Handles camelCase (chatUpload), lowercase (other paths), and `type`
  return (
    attachment?.mimeType ??
    attachment?.mimetype ??
    attachment?.type ??
    ""
  );
}

function isImageAttachment(attachment: any): boolean {
  const mime = getMimeType(attachment);
  if (mime) return mime.startsWith("image/");
  return IMAGE_EXTENSIONS.has(getExtension(attachment));
}

function isPdfAttachment(attachment: any): boolean {
  const mime = getMimeType(attachment);
  if (mime) return mime === "application/pdf";
  return getExtension(attachment) === "pdf";
}

function findFirstImage(attachments: any[]): any | undefined {
  return attachments.find(isImageAttachment);
}

function findFirstPdf(attachments: any[]): any | undefined {
  return attachments.find(isPdfAttachment);
}

// ── Path resolution ───────────────────────────────────────────────────────────
// chatUpload.ts stores a relative path like "uploads/chat/<file>" in the DB
// and returns it as-is in the upload response. The Python runtime (local or
// remote worker) needs an absolute filesystem path.

function resolveAttachmentPath(attachment: any): string {
  const raw: string = attachment?.path ?? "";
  if (!raw) return raw;
  if (path.isAbsolute(raw)) return raw;
  return path.join(process.cwd(), raw);
}

// ── LLM caller (reused by selector fallback) ──────────────────────────────────

// ── Core types ────────────────────────────────────────────────────────────────

export interface ToolHistoryEntry {
  toolCall: ToolCall;
  result: any;
}

export interface PipelineResult {
  toolCalls: ToolCall[];
  results: any[];
}

// ── Execute a batch of tool calls ────────────────────────────────────────────

async function executeBatch(
  toolCalls: ToolCall[],
  calledTools: Set<string>
): Promise<ToolHistoryEntry[]> {

  // Split into parallel-safe and sequential
  const parallel: ToolCall[] = [];
  const sequential: ToolCall[] = [];

  for (const call of toolCalls) {
    if (calledTools.has(call.tool)) {
      console.log(`[PIPELINE] Skipping duplicate tool: ${call.tool}`);
      continue;
    }
    const def = getToolDef(call.tool);
    if (def?.parallel !== false) {
      parallel.push(call);
    } else {
      sequential.push(call);
    }
  }

  const entries: ToolHistoryEntry[] = [];

  // Execute parallel tools concurrently
  if (parallel.length > 0) {
    console.log(`[PIPELINE] Running ${parallel.length} tool(s) in parallel:`, parallel.map(t => t.tool));
    const parallelResults = await Promise.all(
      parallel.map(async (call) => {
        calledTools.add(call.tool);
        try {
          const result = await executeTool(call);
          return { toolCall: call, result };
        } catch (err) {
          console.error(`[PIPELINE] Tool error (${call.tool}):`, err);
          return {
            toolCall: call,
            result: { success: false, error: String(err) },
          };
        }
      })
    );
    entries.push(...parallelResults);
  }

  // Execute sequential tools one at a time
  for (const call of sequential) {
    console.log(`[PIPELINE] Running sequential tool: ${call.tool}`);
    calledTools.add(call.tool);
    try {
      const result = await executeTool(call);
      entries.push({ toolCall: call, result });
    } catch (err) {
      console.error(`[PIPELINE] Tool error (${call.tool}):`, err);
      entries.push({
        toolCall: call,
        result: { success: false, error: String(err) },
      });
    }
  }

  return entries;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function processTools(
    toolCalls: ToolCall[],
    uploadedAttachments: any[] = [],
    userPrompt: string = ""
): Promise<PipelineResult | null> {

  console.log("\n========== TOOL EXECUTOR ==========");

  if (!toolCalls || toolCalls.length === 0) {
    console.log("[EXECUTOR] No tools requested.");
    console.log("===================================\n");
    return null;
  }

  const calledTools = new Set<string>();

  if (uploadedAttachments.length > 0) {

    const firstImage = findFirstImage(uploadedAttachments);
    const firstPdf = findFirstPdf(uploadedAttachments);

    for (const toolCall of toolCalls) {
        if (!toolCall.arguments) {
            toolCall.arguments = {};
        }

        switch (toolCall.tool) {

            case "local_vision_ocr":
            case "layout_analyzer":
            case "local_vision_analyzer":

                // Always use the actual uploaded image path.
                // The router should decide *which* tool to use,
                // not the filesystem path.
                if (firstImage) {
                    toolCall.arguments.image_path = resolveAttachmentPath(firstImage);
                }

                // Ensure the vision analyzer always receives a prompt.
                if (
                    toolCall.tool === "local_vision_analyzer" &&
                    !toolCall.arguments.prompt
                ) {
                    toolCall.arguments.prompt =
                        toolCall.arguments.query ||
                        toolCall.arguments.question ||
                        userPrompt ||
                        "Describe this image.";
                  }

                  break;

            case "marker_pdf_pipeline":

                // Always use the actual uploaded PDF path.
                if (firstPdf) {
                    toolCall.arguments.pdf_path = resolveAttachmentPath(firstPdf);
                }

                break;

        }
    }

  }

  const batch = await executeBatch(
    toolCalls,
    calledTools
  );

  batch.forEach(entry => {

    const preview = JSON.stringify(entry.result).slice(0, 150);

    console.log(
      `[RESULT] ${entry.toolCall.tool} -> ${preview}${preview.length >= 150 ? "..." : ""}`
    );

  });

  console.log("===================================\n");

  if (batch.length === 0) {
    return null;
  }

  return {
    toolCalls: batch.map(entry => entry.toolCall),
    results: batch.map(entry => entry.result),
  };

}