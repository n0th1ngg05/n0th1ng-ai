/**
 * phaseTracker.ts
 * ================
 * Lightweight Execution State Manager that runs alongside the agent loop.
 * Uses lfm2.5-thinking:1.2b (already warm from Stage 3 routing) as a cheap
 * stateful co-pilot to classify, track, and surface execution progress.
 *
 * Design principles:
 *  - Non-blocking: all errors are caught silently; tracker failure never
 *    breaks the main loop.
 *  - Event-driven: phase completion is triggered by real events (tool
 *    success/failure, narration signals) — not by round count.
 *  - Confidence + revision: the tracker maintains a heuristic alignment
 *    score and an explicit revision counter so that replanning events are
 *    traceable and debuggable.
 *  - ExecutionState (not PhaseTrackerState): named generically because this
 *    service is an Execution State Manager — future features (parallel
 *    branches, retries, checkpoints, conditional execution) all live here.
 */

// Ollama is called via raw fetch (same pattern as toolRouter.ts)
// No npm package import needed — uses the local Ollama HTTP API directly.

// ─── Public Types ──────────────────────────────────────────────────────────────

export type PhaseStatus = "pending" | "in_progress" | "done" | "failed" | "skipped";
export type CompletionEvent = "tool_success" | "tool_failure" | "narration" | "replan";

export interface ExecutionPhase {
  id: number;
  description: string;
  /** Current lifecycle status of this phase. */
  status: PhaseStatus;
  /** Which event caused the most recent status change. */
  completedBy?: CompletionEvent;
  /** Which tool was actually dispatched to fulfil this phase. */
  toolDispatched?: string;
}

/**
 * ExecutionState — the canonical state object owned by PhaseTrackerService.
 *
 * Named "ExecutionState" (not PhaseTrackerState) to reflect that this service
 * is an Execution State Manager.  Future additions — parallel branches, retry
 * counters, checkpoints, conditional logic, branch merging — all belong here.
 */
export interface ExecutionState {
  /** One-sentence summary of the user's overall goal. */
  goal: string;
  /**
   * Revision counter.  Starts at 1.  Incremented ONLY when the planner
   * intentionally changes strategy (replanning), never on plain status updates.
   */
  revision: number;
  /**
   * Heuristic confidence: 0.0–1.0.
   * Represents how well the planner's current behaviour matches the declared plan.
   * High = planner follows the plan exactly.
   * Low  = planner is drifting or deviating significantly.
   */
  confidence: number;
  phases: ExecutionPhase[];
  /** ID of the currently active (next to execute) phase, or null if complete. */
  currentPhaseId: number | null;
  /** Tracker's latest observation / reasoning note. */
  notes: string;
  /** False until processRound1 succeeds at least once. */
  initialized: boolean;
  /**
   * Main model's visible narration per round — NOT tool results.
   * Used to build the compact history injected into subsequent prompts,
   * so the model has continuity without re-reading the 30KB+ full transcript.
   */
  llmOutputHistory: Array<{ round: number; text: string }>;
}

// ─── Internal Parser Types ─────────────────────────────────────────────────────

interface GenerateOutput {
  goal?: string;
  phases?: Array<{ id: number; description: string }>;
  confidence?: number;
  notes?: string;
}

interface UpdateOutput {
  phases?: ExecutionPhase[];
  confidence?: number;
  isReplanning?: boolean;
  revision?: number;
  currentPhaseId?: number | null;
  notes?: string;
  expanded?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRACKER_MODEL            = "lfm2.5-thinking:1.2b";
/** Max ms to wait for the small model before giving up (non-blocking). */
const TRACKER_TIMEOUT_MS       = 30_000;
/** How many chars of each LLM narration round to store in history. */
const LLM_OUTPUT_PREVIEW_CHARS = 300;
/** How many chars of a tool result to send to the UPDATE prompt. */
const RESULT_PREVIEW_CHARS     = 400;
/** Max past rounds to include in the injected context block. */
const HISTORY_MAX_ROUNDS       = 5;

// ─── System Prompts ────────────────────────────────────────────────────────────

const GENERATE_SYSTEM = `\
You are an Execution State Manager for an AI agent loop.
Read the AI assistant's first response to a multi-step user request.

Extract:
1. goal       — a one-sentence summary of what the overall task accomplishes
2. phases     — ALL planned atomic execution steps (one real tool action each)
3. confidence — how clearly extractable the plan is (0.0 = completely unclear, 1.0 = crystal clear)
4. notes      — any observations about the plan structure

Output ONLY valid JSON — nothing else, no explanation:
{
  "goal": "...",
  "phases": [
    {"id": 1, "description": "..."},
    {"id": 2, "description": "..."}
  ],
  "confidence": 0.95,
  "notes": "..."
}

Rules:
- Each phase = exactly one atomic tool action (search, save, calculate, read URL, etc.)
- Use exact topic/name from the AI response wherever possible
- If a phase covers multiple unknown items (e.g. "search each cast member individually"),
  create ONE placeholder phase with the description ending in "(expand after discovering items)"
- Do NOT include meta-phases like "plan", "think", "summarise", "review" — only concrete actions
- id values are sequential integers starting at 1
- Minimum 1 phase, maximum 20 phases`;

const UPDATE_SYSTEM = `\
You are an Execution State Manager for an AI agent loop.
Update the ExecutionState based on what just happened.

You receive:
- Current ExecutionState (phases with statuses, confidence, revision)
- An event: "tool_success" or "tool_failure"
- Which tool ran and its result/error preview
- The planner's latest narration (may reveal new specific information)

Update rules:
- tool_success: mark the first "in_progress" phase (or closest matching "pending" phase) as "done"
  with completedBy="tool_success" and toolDispatched set to the tool name.
- tool_failure: mark the active phase as "failed" with completedBy="tool_failure". Reduce confidence.
- Scan the narration for completion signals ("I found...", "Done...", "Saved...") to corroborate.
- Phase expansion: if a vague placeholder phase ends with "(expand after discovering items)" AND
  the narration now contains specific names/values, REPLACE that single phase with multiple specific
  phases (one per item). Renumber all subsequent IDs correctly. Set expanded=true.
- Set currentPhaseId to the id of the first phase whose status is "pending" or "in_progress".
- Update confidence (0.0–1.0) based on how well the planner seems to be following the plan.
- Replanning detection: if the planner is ABANDONING the plan structure entirely (not just
  progressing through it step by step), set isReplanning=true. Normal execution is NOT replanning.
  Be conservative — only set true for major strategy changes.
- Updating a phase status is NEVER replanning (isReplanning must be false, revision unchanged).

Output ONLY valid JSON — nothing else:
{
  "phases": [...],
  "confidence": 0.87,
  "isReplanning": false,
  "revision": 1,
  "currentPhaseId": 3,
  "notes": "...",
  "expanded": false
}`;

// ─── Service ───────────────────────────────────────────────────────────────────

export class PhaseTrackerService {
  private state: ExecutionState = {
    goal:             "",
    revision:         1,
    confidence:       0,
    phases:           [],
    currentPhaseId:   null,
    notes:            "",
    initialized:      false,
    llmOutputHistory: [],
  };

  // ── Public API ────────────────────────────────────────────────────────────────

  get isInitialized(): boolean {
    return this.state.initialized;
  }

  /** Read-only snapshot of the full execution state. */
  get executionState(): Readonly<ExecutionState> {
    return this.state;
  }

  /**
   * Phases that are not yet resolved — status "pending" or "in_progress".
   * Used by the agent loop's plan-completeness gate: if the main model
   * gives a final answer while phases are still open here, the loop can
   * challenge it instead of silently accepting an early stop.
   * Returns [] when the tracker was never initialized (e.g. GENERATE
   * classification failed) — callers should treat that as "nothing to
   * gate on", not "everything is incomplete".
   */
  getIncompletePhases(): ExecutionPhase[] {
    if (!this.state.initialized) return [];
    return this.state.phases.filter(
      (p) => p.status === "pending" || p.status === "in_progress",
    );
  }

  /**
   * Store the main model's visible narration for this round.
   * Call BEFORE processRound1 / onToolSuccess so history is current.
   */
  addLLMOutput(round: number, text: string): void {
    const preview = text.slice(0, LLM_OUTPUT_PREVIEW_CHARS);
    this.state.llmOutputHistory.push({ round, text: preview });
    console.log(`[TRACKER] Stored round ${round} narration (${text.length} chars → ${preview.length} char preview)`);
  }

  /**
   * Round 1 only — classify the initial plan from the main model's first response.
   * Calls the GENERATE prompt on lfm2.5-thinking:1.2b.
   * Non-blocking: silently degrades on failure.
   */
  async processRound1(visibleText: string, userGoal: string): Promise<void> {
    console.log("[TRACKER] GENERATE — classifying initial execution plan");
    try {
      const userPrompt =
        `User goal: ${userGoal}\n\n` +
        `AI's first response:\n${visibleText.slice(0, 1200)}\n\n` +
        `Extract the execution phases JSON:`;

      const raw = await this.callSmallModel(GENERATE_SYSTEM, userPrompt);
      if (!raw) {
        console.warn("[TRACKER] GENERATE: small model returned no output — tracker not initialized");
        return;
      }

      const parsed = this.extractJSON<GenerateOutput>(raw);
      if (!parsed?.phases?.length) {
        console.warn("[TRACKER] GENERATE: could not parse phases:", raw.slice(0, 300));
        return;
      }

      this.state.goal           = parsed.goal ?? userGoal;
      this.state.confidence     = clamp(parsed.confidence ?? 0.8, 0, 1);
      this.state.notes          = parsed.notes ?? "";
      this.state.phases         = parsed.phases.map((p) => ({
        id:          p.id,
        description: p.description,
        status:      "pending" as PhaseStatus,
      }));
      this.state.currentPhaseId = this.state.phases[0]?.id ?? null;
      this.state.revision       = 1;
      this.state.initialized    = true;

      console.log(
        `[TRACKER] Initialized | goal="${this.state.goal.slice(0, 80)}" | ` +
        `phases=${this.state.phases.length} | confidence=${this.state.confidence.toFixed(2)} | revision=1`
      );
      console.log(
        "[TRACKER] Phase plan:\n" +
        this.state.phases.map((p) => `  [${p.id}] ${p.description}`).join("\n")
      );
    } catch (err) {
      console.warn("[TRACKER] processRound1 error (non-fatal):", err);
    }
  }

  /**
   * Event: tool executed successfully.
   * Marks the appropriate phase done, optionally expands placeholder phases.
   */
  async onToolSuccess(
    tool: string,
    args: Record<string, unknown>,
    resultPreview: string,
  ): Promise<void> {
    if (!this.state.initialized) return;
    console.log(`[TRACKER] Event: tool_success | tool=${tool}`);
    await this.runUpdatePrompt(
      "tool_success", tool, args, resultPreview.slice(0, RESULT_PREVIEW_CHARS)
    );
  }

  /**
   * Event: tool execution failed.
   * Marks the active phase failed and reduces confidence.
   */
  async onToolFailure(
    tool: string,
    args: Record<string, unknown>,
    error: string,
  ): Promise<void> {
    if (!this.state.initialized) return;
    console.log(`[TRACKER] Event: tool_failure | tool=${tool} | error=${error}`);
    await this.runUpdatePrompt("tool_failure", tool, args, `ERROR: ${error}`);
  }

  /**
   * Build the PLAN TRACKER block to inject into the transcript before the
   * next round.  Returns an empty string when not initialized.
   *
   * Contents:
   *  - Phase status list with ✅/▶/⬜/❌ icons and [CURRENT] markers
   *  - Low-confidence warning (<50%)
   *  - Revision notice (if > 1)
   *  - Compact LLM narration history (own words only, NOT tool results)
   */
  buildContextBlock(roundNumber: number): string {
    if (!this.state.initialized || this.state.phases.length === 0) return "";

    const done  = this.state.phases.filter((p) => p.status === "done").length;
    const total = this.state.phases.length;

    const headerParts = [
      `Round ${roundNumber}`,
      `${done}/${total} phases complete`,
      this.state.revision > 1 ? `Revision ${this.state.revision}` : null,
      `Confidence ${(this.state.confidence * 100).toFixed(0)}%`,
    ].filter(Boolean).join(" | ");

    const lines: string[] = [
      "==================================================",
      `PLAN TRACKER — ${headerParts}`,
      "==================================================",
      "",
    ];

    for (const phase of this.state.phases) {
      const isCurrent = phase.id === this.state.currentPhaseId;
      const icon =
        phase.status === "done"    ? "✅" :
        phase.status === "failed"  ? "❌" :
        phase.status === "skipped" ? "⏭ " :
        isCurrent                  ? "▶  " : "⬜ ";
      const suffix =
        isCurrent                  ? " [CURRENT — act on this next]" :
        phase.status === "done"    ? " [done]"    :
        phase.status === "failed"  ? " [failed]"  :
        phase.status === "skipped" ? " [skipped]" : "";
      lines.push(`${icon} Phase ${phase.id}: ${phase.description}${suffix}`);
    }

    if (this.state.confidence < 0.5) {
      lines.push(
        "",
        `⚠  Tracker confidence is low (${(this.state.confidence * 100).toFixed(0)}%) — ` +
        `execution may have drifted from the original plan.`,
      );
    }

    if (this.state.revision > 1) {
      lines.push(
        "",
        `ℹ  Plan has been revised ${this.state.revision - 1} time(s). ` +
        `Current revision: ${this.state.revision}.`,
      );
    }

    const recentHistory = this.state.llmOutputHistory.slice(-HISTORY_MAX_ROUNDS);
    if (recentHistory.length > 0) {
      lines.push(
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Your previous outputs (your words only — not tool results):",
        "",
      );
      for (const entry of recentHistory) {
        lines.push(`[Round ${entry.round}]: "${entry.text}"`);
      }
    }

    lines.push("==================================================");
    return lines.join("\n");
  }

  // ── Private Helpers ────────────────────────────────────────────────────────────

  private async runUpdatePrompt(
    eventType: "tool_success" | "tool_failure",
    tool: string,
    args: Record<string, unknown>,
    resultOrError: string,
  ): Promise<void> {
    try {
      const latestNarration = this.state.llmOutputHistory.at(-1)?.text ?? "(none)";

      const userPrompt = [
        `Current ExecutionState:`,
        JSON.stringify({
          goal:           this.state.goal,
          revision:       this.state.revision,
          confidence:     this.state.confidence,
          currentPhaseId: this.state.currentPhaseId,
          phases:         this.state.phases,
        }, null, 2),
        ``,
        `Event: ${eventType}`,
        `Tool dispatched: ${tool}`,
        `Tool arguments: ${JSON.stringify(args)}`,
        `Result/error preview: ${resultOrError}`,
        ``,
        `Planner's latest narration:`,
        latestNarration,
        ``,
        `Update the ExecutionState JSON:`,
      ].join("\n");

      const raw = await this.callSmallModel(UPDATE_SYSTEM, userPrompt);
      if (!raw) return;

      const parsed = this.extractJSON<UpdateOutput>(raw);
      if (!parsed?.phases?.length) {
        console.warn("[TRACKER] UPDATE: could not parse update output:", raw.slice(0, 300));
        return;
      }

      // Replanning → increment revision (never decremented)
      const isReplanning = parsed.isReplanning === true;
      if (isReplanning) {
        this.state.revision += 1;
        console.log(`[TRACKER] Replanning detected — revision bumped to ${this.state.revision}`);
      }

      this.state.phases        = parsed.phases;
      this.state.confidence    = clamp(parsed.confidence ?? this.state.confidence, 0, 1);
      this.state.currentPhaseId =
        parsed.currentPhaseId !== undefined
          ? parsed.currentPhaseId
          : this.findNextActivePhaseId();
      this.state.notes = parsed.notes ?? "";

      const doneCount = this.state.phases.filter((p) => p.status === "done").length;
      console.log(
        `[TRACKER] State updated after ${eventType} | ` +
        `done=${doneCount}/${this.state.phases.length} | ` +
        `currentPhaseId=${this.state.currentPhaseId} | ` +
        `confidence=${this.state.confidence.toFixed(2)} | ` +
        `revision=${this.state.revision}` +
        (parsed.expanded ? " | phases expanded ✓" : ""),
      );
      if (this.state.notes) {
        console.log(`[TRACKER] Notes: ${this.state.notes}`);
      }
    } catch (err) {
      console.warn("[TRACKER] runUpdatePrompt error (non-fatal):", err);
    }
  }

  private findNextActivePhaseId(): number | null {
    const next = this.state.phases.find(
      (p) => p.status === "pending" || p.status === "in_progress",
    );
    return next?.id ?? null;
  }

  /**
   * Call lfm2.5-thinking:1.2b via raw fetch to the local Ollama HTTP API.
   * Matches the pattern used by toolRouter.ts Stage 3.
   * Returns null on timeout or any error (non-blocking).
   */
  private async callSmallModel(system: string, user: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => {
      console.warn(`[TRACKER] Small model timed out after ${TRACKER_TIMEOUT_MS}ms — skipping`);
      controller.abort();
    }, TRACKER_TIMEOUT_MS);

    try {
      const response = await fetch("http://localhost:11434/api/chat", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model:   TRACKER_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user",   content: user   },
          ],
          stream:  false,
          format:  "json",
          options: { temperature: 0.1, num_predict: 1024 },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.warn(`[TRACKER] HTTP error ${response.status}:`, errText.slice(0, 200));
        return null;
      }

      const data    = await response.json() as { message?: { content?: string } };
      const content = data?.message?.content ?? "";
      if (!content.trim()) {
        console.warn("[TRACKER] Small model returned empty content");
        return null;
      }
      return content;
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        console.warn("[TRACKER] callSmallModel fetch error:", err);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Safely extract the first JSON object from raw model output.
   * Handles both clean JSON (from format:"json") and markdown-fenced JSON.
   */
  private extractJSON<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch { /* fall through */ }

    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch { /* fall through */ }
    }

    console.warn("[TRACKER] extractJSON: failed to parse:", raw.slice(0, 200));
    return null;
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}