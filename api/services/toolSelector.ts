// ─────────────────────────────────────────────────────────────────────────────
// toolSelector.ts
//
// Tool selection now happens entirely inside toolRouter.ts, using the main
// chat LLM as the planner (see shouldUseTools()). The old dedicated 0.6b
// selector model, its deterministic rule engine, and its standalone LLM
// fallback prompt are gone.
//
// The only thing this file still owns is the shared ToolCall type, since
// cluster.ts, toolExecutor.ts, and toolPipeline.ts all import it from here.
// Keeping the type here (instead of moving it) avoids touching import paths
// across the rest of the pipeline.
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolCall {
  tool: string;
  arguments: Record<string, string>;
}