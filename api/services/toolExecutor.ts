// ─────────────────────────────────────────────────────────────────────────────
// toolExecutor.ts
//
// CHANGES FROM ORIGINAL
//   • Validates required arguments before calling; returns a typed error result
//     instead of crashing or silently sending undefined.
//   • Accepts the new ToolCall type from toolSelector.ts.
//   • Tool-specific argument extraction is explicit — no silent fallbacks.
//   • Added structured ExecutionResult type for downstream consumers.
// ─────────────────────────────────────────────────────────────────────────────

import { searchKnowledge } from "./semanticSearch";
import { getDb } from "../queries/connection";
import { systemSnapshots } from "@db/schema";
import { desc } from "drizzle-orm";
import { getInstalledModels } from "./modelManager";
import { getRunningModels } from "./ollamaControl";
import { getDatabaseStats } from "./sqlQuery";
import { searchInternet, formatSearchResults } from "./tavily";
import { readUrl, formatPageContent } from "./firecrawl";
import { performResearch } from "./research";
import {
  memoryStore,
  memorySearch,
  getAllMemories,
  memoryUpdate,
  memoryDelete,
} from "./memory";

import type { ToolCall } from "./toolSelector";
import { executeClusterTool } from "./cluster";

// ── Result type ───────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
}

// ── Argument helpers ──────────────────────────────────────────────────────────

function requireArg(
  args: Record<string, string> | undefined,
  key: string,
  toolName: string
): string | ExecutionResult {
  const value = args?.[key]?.trim();
  if (!value) {
    return {
      success: false,
      error: `Tool '${toolName}' is missing required argument: '${key}'`,
    };
  }
  return value;
}

function isError(v: string | ExecutionResult): v is ExecutionResult {
  return typeof v === "object";
}

// ── Executor ──────────────────────────────────────────────────────────────────

export async function executeTool(
  toolCall: ToolCall | null | undefined
): Promise<ExecutionResult> {

  if (!toolCall?.tool) {
    return { success: false, error: "No tool call provided" };
  }

  const { tool, arguments: args } = toolCall;

  // Log tool name + argument keys (not values — queries can be long).
  const argKeys = Object.keys(args ?? {});
  console.log(`[EXECUTOR] Running tool: ${tool} | args: [${argKeys.join(", ")}]`);
  const execStart = Date.now();

  // ── Pre-dispatch validation for cluster/python-routed tools ─────────────────
  // executeClusterTool() sends these straight to a worker or the local Python
  // runtime WITHOUT ever calling the localExecutor switch below, so argument
  // validation for them has to happen here, not inside the switch.
  switch (tool) {
    case "local_vision_ocr":
    case "layout_analyzer": {
      const imagePath = requireArg(args, "image_path", tool);
      if (isError(imagePath)) return imagePath;
      break;
    }
    case "marker_pdf_pipeline": {
      const pdfPath = requireArg(args, "pdf_path", tool);
      if (isError(pdfPath)) return pdfPath;
      break;
    }
    case "local_vision_analyzer": {
      const imagePath = requireArg(args, "image_path", tool);
      if (isError(imagePath)) return imagePath;
      const visionPrompt = requireArg(args, "prompt", tool);
      if (isError(visionPrompt)) return visionPrompt;
      break;
    }
  }

  try {
     const execResult = await executeClusterTool(
        toolCall.tool,
        toolCall,
        async () => {

    switch (tool) {

      // ── Knowledge / File search ─────────────────────────────────────────────

      case "knowledge_search":
      case "file_search": {
        const query = requireArg(args, "query", tool);
        if (isError(query)) return query;
        const results = await searchKnowledge(query);
        return { success: true, result: results };
      }

      // ── Internet search ─────────────────────────────────────────────────────

      case "internet_search": {
        const query = requireArg(args, "query", tool);
        if (isError(query)) return query;
        const rawResults = await searchInternet(query);
        const formattedResults = formatSearchResults(rawResults);
        return { success: true, result: formattedResults };
      }

      // ── Deep research ───────────────────────────────────────────────────────

      case "research_query": {
        const query = requireArg(args, "query", tool);
        if (isError(query)) return query;
        const result = await performResearch(query);
        return { success: true, result };
      }

      // ── URL reader ──────────────────────────────────────────────────────────

      case "url_reader": {
        const url = requireArg(args, "url", tool);
        if (isError(url)) return url;
        const page = await readUrl(url);
        const content = formatPageContent(page);
        return { success: true, result: content };
      }

      // ── Scientific calculator ───────────────────────────────────────────────

      case "scientific_calculator": {

      const expression = requireArg(args, "expression", tool);
      if (isError(expression)) return expression;

      const safeExpression = expression.replace(
          /[^0-9+\-*/().,%^ eE]/g,
          ""
      );

      // eslint-disable-next-line no-eval
      const result = eval(safeExpression);

      return {
          success: true,
          result,
        };

      }

      // ── System monitor ──────────────────────────────────────────────────────

      case "system_monitor": {
        const db = getDb();
        const latest = await db.query.systemSnapshots.findFirst({
          orderBy: [desc(systemSnapshots.createdAt)],
        });
        return { success: true, result: latest ?? null };
      }

      // ── Model manager (installed models) ────────────────────────────────────

      case "model_manager": {
        const models = await getInstalledModels();
        return { success: true, result: models };
      }

      // ── Ollama control (running models) ─────────────────────────────────────

      case "ollama_control": {
        const running = await getRunningModels();
        return { success: true, result: running };
      }

      // ── Database stats ──────────────────────────────────────────────────────

      case "sql_query": {
        const query = requireArg(args, "query", tool);
        if (isError(query)) return query;
        const stats = await getDatabaseStats();
        return { success: true, result: stats };
      }

      // ── Memory: store ───────────────────────────────────────────────────────

      case "memory_store": {
        const category = requireArg(args, "category", tool);
        if (isError(category)) return category;
        const key = requireArg(args, "key", tool);
        if (isError(key)) return key;
        const value = requireArg(args, "value", tool);
        if (isError(value)) return value;

        const result = await memoryStore(category, key, value);
        return { success: true, result };
      }

      // ── Memory: search ──────────────────────────────────────────────────────

      case "memory_search": {
        const query = requireArg(args, "query", tool);
        if (isError(query)) return query;
        const result = await memorySearch(query);
        return { success: true, result };
      }

      // ── Memory: update ──────────────────────────────────────────────────────

      case "memory_update": {
        const key = requireArg(args, "key", tool);
        if (isError(key)) return key;
        const value = requireArg(args, "value", tool);
        if (isError(value)) return value;
        const result = await memoryUpdate(key, value);
        return { success: true, result };
      }

      // ── Memory: delete ──────────────────────────────────────────────────────

      case "memory_delete": {
        const key = requireArg(args, "key", tool);
        if (isError(key)) return key;
        const result = await memoryDelete(key);
        return { success: true, result };
      }

      // ── Vision / document tools ──────────────────────────────────────────────
      // These are always routed via executeClusterTool → PYTHON_TOOLS →
      // pythonRuntimeClient (or a remote worker). This branch only runs if a
      // worker was selected, failed, and the tool was NOT recognized as a
      // python tool — i.e. it should not normally be reached. Kept as a
      // defensive fallback rather than falling through to "Unknown tool".

      case "local_vision_ocr":
      case "layout_analyzer":
      case "marker_pdf_pipeline":
      case "local_vision_analyzer": {
        return {
          success: false,
          error: `Tool '${tool}' has no local (non-Python) executor. Check PYTHON_TOOLS registration in pythonTools.ts.`,
        };
      }

      // ── Unknown ─────────────────────────────────────────────────────────────

      default: {
        return {
          success: false,
          error: `Unknown tool: '${tool}'. Check your tool registry.`,
        };
      }

    }
  }
);

    const elapsed = Date.now() - execStart;
    if (execResult.success) {
      const resultStr = JSON.stringify(execResult.result);
      const resultType = Array.isArray(execResult.result) ? "array" : typeof execResult.result;
      const preview = resultStr.slice(0, 150);
      console.log(
        `[EXECUTOR] Tool '${tool}' done in ${elapsed}ms | success=true | type=${resultType} size=${resultStr.length} chars | preview: ${preview}${resultStr.length > 150 ? "..." : ""}`
      );
    } else {
      console.error(`[EXECUTOR] Tool '${tool}' done in ${elapsed}ms | success=false | error: ${execResult.error}`);
    }
    return execResult;

  } catch (err: any) {
    const elapsed = Date.now() - execStart;
    console.error(`[EXECUTOR] Tool '${tool}' threw after ${elapsed}ms:`, err);
    return {
      success: false,
      error: err?.message ?? String(err),
    };
  }

}