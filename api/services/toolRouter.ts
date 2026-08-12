// ─────────────────────────────────────────────────────────────────────────────
// toolRouter.ts
//
// FIVE-STAGE TOOL RESOLUTION CASCADE
//
// Stage 0 — Cheap pre-check (no LLM call at all).
//            Obvious non-tool chat ("hi", "thanks", "how are you") is caught
//            by a tiny heuristic and short-circuits straight to CHAT mode.
//
// Stage 1 — Yes/No gate, main chat model (body.model, e.g. nemotron-3-nano:4b).
//            A single boolean question: "does this need tools?" The main
//            model is NOT shown the tool list and does NOT pick tools itself
//            — it only decides whether the cascade should continue. No →
//            CHAT mode, done, no further model calls.
//
// Stage 2 — Regex matching (toolPatterns.ts, a dedicated pattern set separate
//            from the loose `triggers` arrays in tools.ts). If it cleanly
//            resolves the tool(s) with usable default arguments → use them
//            directly, skip Stage 3 entirely. If it finds nothing, or finds
//            an ambiguous/confusable-cluster collision, or resolves a tool
//            name but can't produce real arguments (file paths etc.) → fall
//            through to Stage 3.
//
// Stage 3 — Small model fill-in (qwen3:0.6b, native tool-calling via
//            /api/chat + `tools`). Gets the original question, the
//            conversation context, attachment hints, and — when Stage 2
//            partially resolved something — a hint about what's already
//            been decided so it isn't starting cold. Resolves whatever
//            Stage 2 couldn't.
//
// Stage 4 — Execution. Unchanged: merged tool list flows through
//            toolPipeline.ts → toolExecutor.ts → cluster.ts exactly as
//            before. This file does not touch execution at all — it only
//            produces the ToolDecision that boot.ts already knows how to
//            consume.
//
// The exported `shouldUseTools(model, prompt, context, attachments)` signature
// and `ToolDecision` shape are preserved byte-for-byte so boot.ts requires
// zero changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolCall } from "./toolSelector";
import { toolsForNativeSchema, getToolDef } from "./tools";
import {
    matchPatterns,
    buildDefaultArguments,
    type PatternMatch,
} from "./toolPattern";

export type ToolDecision = {

    mode:
        | "CHAT"
        | "TOOL"
        | "RAG"
        | "TOOL_RAG";

    status: string;

    tools: ToolCall[];

};

const OLLAMA_CHAT_URL = "http://localhost:11434/api/chat";
const OLLAMA_GENERATE_URL = "http://localhost:11434/api/generate";

// ── Stage 3 model ─────────────────────────────────────────────────────────────
// Small model, fast, native tool-calling. Only invoked when Stage 0/1/2
// couldn't fully resolve the request on their own.

export const ROUTER_MODEL =
    process.env.TOOL_ROUTER_MODEL ?? "lfm2.5-thinking:1.2b";

// ── Tools requiring real argument extraction ─────────────────────────────────
// Regex can name a tool but can't extract a file path, a parsed expression
// with real semantics, or key/value pairs. buildDefaultArguments() already
// encodes which tools it CAN fill in from the raw message (query-shaped
// tools) — anything it returns null for needs Stage 3, even if Stage 2
// cleanly identified the tool name.

function regexCanFullyResolve(match: PatternMatch, message: string): ToolCall | null {
    const args = buildDefaultArguments(match.tool, message);
    if (args === null) return null;
    return { tool: match.tool, arguments: args };
}

// ── Stage 0 — cheap pre-check ─────────────────────────────────────────────────
// No model call. Catches short, obviously conversational messages so the
// cascade never spends a request on "hi" or "thanks". Deliberately
// conservative — anything with real content, a question mark on a
// substantive question, a URL, a file reference, etc. falls through to
// Stage 1 rather than risk a false negative here.

const CHEAP_CHAT_PATTERNS: RegExp[] = [
    /^\s*(hi|hey|hello|yo|sup|hiya)[\s!.,]*$/i,
    /^\s*(good\s*(morning|afternoon|evening|night))[\s!.,]*$/i,
    /^\s*(thanks|thank\s*you|thx|ty|cheers|appreciated?)[\s!.,]*$/i,
    /^\s*(how\s*are\s*you|how'?s\s*it\s*going|what'?s\s*up|how\s*(are|r)\s*(u|ya))[\s?!.,]*$/i,
    /^\s*(ok|okay|k|kk|cool|nice|great|got\s*it|sounds\s*good|alright|sure)[\s!.,]*$/i,
    /^\s*(bye|goodbye|see\s*ya|see\s*you|later|night)[\s!.,]*$/i,
    /^\s*(yes|no|yep|nope|yeah|nah)[\s!.,]*$/i,
    /^\s*(lol|lmao|haha+|hehe+)[\s!.,]*$/i,
    /^\s*(who\s*are\s*you|what\s*are\s*you|what'?s\s*your\s*name)[\s?!.,]*$/i,
    /^\s*(tell\s*me\s*a\s*joke)[\s?!.,]*$/i,
];

const CHEAP_CHAT_MAX_LEN = 40;

function cheapPreCheck(message: string, hasAttachments: boolean): boolean {
    // Never short-circuit if a file was attached — the message might be
    // empty/minimal ("here") while genuinely needing a vision/PDF tool.
    if (hasAttachments) return false;

    const trimmed = message.trim();
    if (trimmed.length === 0) return true; // nothing to do anything with
    if (trimmed.length > CHEAP_CHAT_MAX_LEN) return false;

    return CHEAP_CHAT_PATTERNS.some(p => p.test(trimmed));
}

// ── Stage 1 — yes/no gate ─────────────────────────────────────────────────────
// Single boolean ask to the MAIN chat model. This model never sees the tool
// list or picks a tool — it only judges whether the request needs external
// action/data versus being answerable from conversation alone.

const GATE_SYSTEM_PROMPT = `
You are a strict gatekeeper. Do NOT answer the user's question. 
Decide ONLY: does this request require an external tool? 
Reply with EXACTLY one word: "yes" or "no". No punctuation, no explanation.

CRITICAL RULE: You suffer from overconfidence. You MUST heavily bias towards "yes" to prevent hallucinations. 

Say "yes" if the request involves ANY of the following:
- Specific facts, dates, prices, statistics, or real-world entities.
- Real-time data, weather, news, or internet lookup.
- User files, PDFs, images, or local documents.
- Math, calculations, or logical computation.
- Checking system/model status, or reading/writing memories.

Say "no" ONLY if the request is:
- A simple greeting or casual chat (e.g., "Hello", "How are you").
- Purely creative generation (e.g., "Write a fictional story").
- Modifying text that the user provided directly in the prompt (e.g., "Fix the grammar in this sentence").

If there is even 1% doubt, output "yes".
`.trim();

const GATE_TIMEOUT_MS = 12_000;

async function stage1YesNoGate(
    model: string,
    prompt: string,
    conversationContext: string,
    attachmentHint: string
): Promise<boolean> {

    // Flattened into a single prompt string, matching the /api/generate
    // pattern used everywhere else in boot.ts for calls against the main
    // chat model. /api/chat with a messages array was never used against
    // body.model anywhere else — only qwen3:0.6b (Stage 3) uses /api/chat,
    // since that's the one relying on native tool-calling. Using /api/chat
    // here against a main model whose Ollama config may lack a chat
    // template risked an empty/malformed message.content with no error,
    // which silently forced this gate to "yes" on every call.

    const flattenedPrompt = [
        GATE_SYSTEM_PROMPT,
        conversationContext ? `Recent conversation:\n${conversationContext}` : "",
        attachmentHint,
        `User request:\n${prompt}`,
    ]
        .filter(Boolean)
        .join("\n\n");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS);

    try {

        const response = await fetch(OLLAMA_GENERATE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                prompt: flattenedPrompt,
                stream: false,
                options: { temperature: 0 },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            console.error(`[ROUTER][GATE] ${response.status}`, errText);
            // Fail safe: if the gate itself breaks, don't silently drop tool
            // use — let the cascade continue to regex/Stage 3 rather than
            // guaranteeing CHAT mode on an infra hiccup.
            return true;
        }

        const data = await response.json();
        const raw: string = data?.response ?? "";
        const normalized = raw.trim().toLowerCase();

        console.log("[ROUTER][GATE] raw:", JSON.stringify(raw));

        if (normalized.startsWith("no")) return false;
        if (normalized.startsWith("yes")) return true;

        // Unparseable — fail safe toward continuing the cascade.
        console.warn("[ROUTER][GATE] Unparseable gate response, defaulting to yes.");
        return true;

    } catch (err) {

        console.error("[ROUTER][GATE] fetch failed:", err);
        // Network/timeout failure on the gate itself — fail safe toward
        // continuing rather than silently disabling tools cluster-wide.
        return true;

    } finally {

        clearTimeout(timeoutId);

    }

}

// ── Stage 3 — small model fill-in ─────────────────────────────────────────────
// Native tool-calling on qwen3:0.6b, same approach as the previous single-
// stage router. Optionally told what Stage 2 already resolved so it isn't
// re-deciding settled ground — it's asked to fill in what's missing.

const STAGE3_SYSTEM_PROMPT = `
You are the Tool Router for n0th1ng AI.

Your ONLY job is selecting the correct function.
If a tool is required, you MUST return one or more native function calls.

[CORE RULES]
- Never answer the user.
- Never explain your reasoning.
- Never output JSON.
- Never output XML.
- Never output <tools>.
- If a tool is appropriate, call it using native function calling.
- Call the minimum number of tools required (prefer exactly one).
- If no tool is required, return no function calls.
- NEVER hallucinate arguments. If a required file path or value is missing, do not call the tool.
- Tools within the same group below are MUTUALLY EXCLUSIVE. Never call two tools from the same group.

[GROUP 1: VISION & DOCUMENTS]
Decision Order: PDF -> Text -> Layout -> Analysis
* IF input is a PDF file -> USE marker_pdf_pipeline
* IF input is an image AND user wants literal raw text/OCR -> USE local_vision_ocr
* IF input is an image AND user wants document structure/headers/regions -> USE layout_analyzer
* IF input is an image AND user wants a description, explanation, or Q&A -> USE local_vision_analyzer

[GROUP 2: LOCAL KNOWLEDGE]
* IF user names or clearly points to ONE specific file (e.g., "in report.pdf") -> USE file_search
* IF user asks a broad question across notes/documents with no specific file named -> USE knowledge_search

[GROUP 3: WEB & RESEARCH]
* IF user needs quick facts, real-time data, prices, weather, or news -> USE internet_search
* IF user needs deep-dives, multi-source comparisons, or comprehensive analysis -> USE research_query

[GROUP 4: MODEL MANAGEMENT]
* IF user asks what models are currently RUNNING or loaded in memory -> USE ollama_control
* IF user asks what models are INSTALLED or available on disk -> USE model_manager

[GROUP 5: MEMORY]
Decision Order: is this a NEW fact, or a CORRECTION to something already stored?
* IF this is the first time this fact/preference is being saved (default
  assumption when unsure) -> USE memory_store
* IF the user is explicitly correcting or changing a value that was already
  stored before (e.g. "update my", "change my", "my X is now Y", "I switched
  to", "I now use") -> USE memory_update
* memory_update only works on a key that already exists — if you are not
  certain the key was already stored earlier in this conversation, USE
  memory_store instead. When genuinely unsure, prefer memory_store.
* IF user asks what you remember / what their preference is -> USE memory_search
* IF user asks to forget/delete/remove/erase a memory -> USE memory_delete
`.trim();

function buildStage2Hint(
    alreadyResolved: ToolCall[],
    unresolvedMatches: PatternMatch[],
    ambiguousReason: string | null
): string {

    const parts: string[] = [];

    if (alreadyResolved.length > 0) {
        parts.push(
            `A regex pre-pass already resolved and will execute these tool(s), ` +
            `do NOT call them again: ${alreadyResolved.map(t => t.tool).join(", ")}.`
        );
    }

    if (ambiguousReason) {
        parts.push(
            `A regex pre-pass found conflicting/ambiguous signals: ${ambiguousReason} ` +
            `Use full context to pick the correct tool(s) — do not just guess the first one.`
        );
    } else if (unresolvedMatches.length > 0) {
        parts.push(
            `A regex pre-pass flagged tool name(s) that need proper argument ` +
            `extraction (e.g. a file path) that regex can't produce: ` +
            `${unresolvedMatches.map(m => m.tool).join(", ")}. Fill in real arguments.`
        );
    }

    if (parts.length === 0) {
        parts.push("No regex pre-pass signal — decide the tool(s) needed from scratch.");
    }

    return parts.join("\n");
}

function coerceArguments(raw: unknown): Record<string, string> {
    if (!raw) return {};

    let obj: any = raw;

    if (typeof raw === "string") {
        try {
            obj = JSON.parse(raw);
        } catch {
            console.error("[ROUTER][STAGE3] Failed to parse tool arguments string:", raw);
            return {};
        }
    }

    if (typeof obj !== "object" || obj === null) {
        return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return result;
}

const STAGE3_TIMEOUT_MS = 30_000;

async function stage3FillIn(
    prompt: string,
    conversationContext: string,
    attachmentHint: string,
    alreadyResolved: ToolCall[],
    unresolvedMatches: PatternMatch[],
    ambiguousReason: string | null
): Promise<ToolCall[]> {

    const hint = buildStage2Hint(alreadyResolved, unresolvedMatches, ambiguousReason);

    const messages = [
        { role: "system", content: STAGE3_SYSTEM_PROMPT },
        ...(conversationContext
            ? [{ role: "system", content: `Recent conversation:\n${conversationContext}` }]
            : []),
        ...(attachmentHint ? [{ role: "system", content: attachmentHint }] : []),
        { role: "system", content: hint },
        { role: "user", content: prompt },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STAGE3_TIMEOUT_MS);

    let response: Response;

    try {

        response = await fetch(OLLAMA_CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: ROUTER_MODEL,
                messages,
                tools: toolsForNativeSchema(),
                stream: false,
            }),
            signal: controller.signal,
        });

    } catch (err) {

        console.error("[ROUTER][STAGE3] fetch failed:", err);
        return [];

    } finally {

        clearTimeout(timeoutId);

    }

    if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.error(`[ROUTER][STAGE3] ${response.status}`, errText);
        return [];
    }

    const data = await response.json();

    console.log("========== ROUTER STAGE 3 RAW ==========");
    console.log(JSON.stringify(data, null, 2));

    let rawToolCalls = data?.message?.tool_calls;

if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) {

    const content = data?.message?.content ?? "";

    const match = content.match(
        /<tools>\s*([\s\S]*?)\s*<\/tools>/i
    );

    if (match) {

        try {

            const parsed = JSON.parse(match[1]);

            rawToolCalls = [
                {
                    function: {
                        name: parsed.name,
                        arguments: parsed.arguments
                    }
                }
            ];

            console.log(
                "[ROUTER] Parsed XML fallback tool call."
            );

        } catch (err) {

            console.error(
                "[ROUTER] XML fallback parse failed:",
                err
            );

            return [];

        }

    } else {

        // Bare-JSON fallback — some small models (e.g. qwen3:0.6b) ignore
        // both the native tool_calls field and the <tools> XML wrapper and
        // just emit a plain {"name": "...", "arguments": {...}} object
        // directly as the whole message content, with no wrapper at all.
        // Without this, that response fell straight through to `return []`
        // even though the model correctly picked a tool — the "Stage 3
        // called the tool but nothing executed" bug.
        const trimmed = content.trim();

        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {

            try {

                const parsed = JSON.parse(trimmed);

                if (parsed && typeof parsed.name === "string") {

                    rawToolCalls = [
                        {
                            function: {
                                name: parsed.name,
                                arguments: parsed.arguments
                            }
                        }
                    ];

                    console.log(
                        "[ROUTER] Parsed bare-JSON fallback tool call."
                    );

                } else {

                    return [];

                }

            } catch (err) {

                console.error(
                    "[ROUTER] Bare-JSON fallback parse failed:",
                    err
                );

                return [];

            }

        } else {

            return [];

        }

    }

}

    const alreadyResolvedNames = new Set(alreadyResolved.map(t => t.tool));

    return rawToolCalls
        .map((call: any): ToolCall | null => {
            const name = call?.function?.name;
            if (typeof name !== "string" || !name) {
                console.error("[ROUTER][STAGE3] Tool call missing function.name:", call);
                return null;
            }
            if (alreadyResolvedNames.has(name)) {
                // Regex already owns this tool — don't double-execute it.
                console.log(`[ROUTER][STAGE3] Skipping '${name}', already resolved by regex.`);
                return null;
            }
            return {
                tool: name,
                arguments: coerceArguments(call?.function?.arguments),
            };
        })
        .filter((c: ToolCall | null): c is ToolCall => c !== null);

}

// ── Mode / status helpers ─────────────────────────────────────────────────────

function inferMode(toolCalls: ToolCall[]): "CHAT" | "TOOL" {
    return toolCalls.length > 0 ? "TOOL" : "CHAT";
}

function buildStatus(toolCalls: ToolCall[]): string {
    if (toolCalls.length === 0) return "";
    if (toolCalls.length === 1) return `Using ${toolCalls[0].tool}...`;
    return `Gathering information (${toolCalls.length} tools)...`;
}

// ── Attachment hint ───────────────────────────────────────────────────────────
// Small/gate models only see the user's text prompt. This builds a terse
// system message listing every attached file so they know files exist.

function buildAttachmentHint(attachments: any[]): string {
    if (!attachments || attachments.length === 0) return "";

    const lines = attachments.map(a => {
        const name: string =
            a.originalName ??
            a.filename ??
            (typeof a.path === "string" ? a.path.split(/[\\/]/).pop() : null) ??
            "unknown";
        const mime: string =
            a.mimeType ??
            a.mimetype ??
            a.type ??
            "unknown";
        return `  - ${name} (${mime})`;
    });

    return (
        `The user has attached ${attachments.length} file(s) alongside their message:\n` +
        lines.join("\n") + "\n" +
        `Select the appropriate tool to process the attached file(s) based on their ` +
        `type and the user's request. Do NOT skip tool selection just because the ` +
        `prompt text alone doesn't mention a path — the file is already available.`
    );
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function dedupe(toolCalls: ToolCall[]): ToolCall[] {
    const seen = new Set<string>();
    return toolCalls.filter(c => {
        if (seen.has(c.tool)) return false;
        seen.add(c.tool);
        return true;
    });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function shouldUseTools(
    mainChatModel: string,
    prompt: string,
    conversationContext = "",
    uploadedAttachments: any[] = []
): Promise<ToolDecision> {

    const ROUTER_CONTEXT_CHAR_LIMIT = 400;

    const trimmedContext = conversationContext.trim();

    const contextForRouter =
        trimmedContext.length > ROUTER_CONTEXT_CHAR_LIMIT
            ? "…" + trimmedContext.slice(-ROUTER_CONTEXT_CHAR_LIMIT)
            : trimmedContext;

    const attachmentHint = buildAttachmentHint(uploadedAttachments);
    const hasAttachments = uploadedAttachments.length > 0;

    // ── Stage 0 — cheap pre-check ────────────────────────────────────────────

    if (cheapPreCheck(prompt, hasAttachments)) {
        console.log("[ROUTER][STAGE0] Obvious non-tool chat, skipping all model calls.");
        return { mode: "CHAT", tools: [], status: "" };
    }

    // ── Stage 1 — yes/no gate (main chat model) ──────────────────────────────

    const needsTools = await stage1YesNoGate(
        mainChatModel,
        prompt,
        contextForRouter,
        attachmentHint
    );

    console.log(`[ROUTER][STAGE1] needsTools = ${needsTools}`);

    if (!needsTools) {
        return { mode: "CHAT", tools: [], status: "" };
    }

    // ── Stage 2 — regex matching ──────────────────────────────────────────────

    const patternResult = matchPatterns(prompt);

    let resolvedByRegex: ToolCall[] = [];
    let unresolvedMatches: PatternMatch[] = [];
    let ambiguousReason: string | null = null;

    if (patternResult.status === "clean") {

        for (const match of patternResult.matches) {
            const call = regexCanFullyResolve(match, prompt);
            if (call) {
                resolvedByRegex.push(call);
            } else {
                unresolvedMatches.push(match);
            }
        }

    } else if (patternResult.status === "ambiguous") {

        ambiguousReason = patternResult.reason;
        unresolvedMatches = patternResult.matches;

    }
    // status === "none" → resolvedByRegex/unresolvedMatches both stay empty.

    console.log(
        `[ROUTER][STAGE2] status=${patternResult.status} ` +
        `resolved=[${resolvedByRegex.map(t => t.tool).join(", ")}] ` +
        `unresolved=[${unresolvedMatches.map(m => m.tool).join(", ")}]` +
        (ambiguousReason ? ` reason="${ambiguousReason}"` : "")
    );

    // Clean regex resolution with zero leftover ambiguity/unresolved names →
    // skip Stage 3 entirely.
    if (
        patternResult.status === "clean" &&
        unresolvedMatches.length === 0 &&
        resolvedByRegex.length > 0
    ) {

        const finalTools = dedupe(resolvedByRegex);

        return {
            mode: inferMode(finalTools),
            status: buildStatus(finalTools),
            tools: finalTools,
        };

    }

    // ── Stage 3 — small model fill-in ─────────────────────────────────────────
    // Covers: status === "none" (nothing matched), status === "ambiguous"
    // (confusable cluster collision), or a clean match whose tool needs real
    // argument extraction regex can't produce (e.g. image_path/pdf_path).

    const stage3Tools = await stage3FillIn(
        prompt,
        contextForRouter,
        attachmentHint,
        resolvedByRegex,
        unresolvedMatches,
        ambiguousReason
    );

    const finalTools = dedupe([...resolvedByRegex, ...stage3Tools]);

    return {
        mode: inferMode(finalTools),
        status: buildStatus(finalTools),
        tools: finalTools,
    };

}

// ── Agent loop entry point ─────────────────────────────────────────────────────
// Called from agentLoop.ts once per round that the main model wants a tool.
//
// DESIGN: the main model does NOT emit a tool name or JSON arguments. Instead,
// each round it writes ONE fresh, atomic, self-contained natural-language
// instruction describing exactly what it wants done next — e.g. "Search the
// web for Jensen Ackles" — as if a user had typed exactly that sentence.
// resolveAgentToolCall() runs that instruction through the SAME Stage 2
// (regex) + Stage 3 (LFM native function-calling, lfm2.5-thinking:1.2b —
// fine-tuned for function calling) pipeline that shouldUseTools() uses for
// a real user message, just skipping Stage 0 (cheap pre-check) and Stage 1
// (yes/no gate) since we already know a tool is needed — that's the entire
// reason this function is being called.
//
// WHY THE INSTRUCTION MUST BE FRESH PER ROUND (not the original user prompt):
// A multi-part request like "search X, then search each of Y/Z/W
// individually, then save a preference" needs 5 different tool calls with 5
// different arguments. If every round re-ran Stage 2/3 against the ORIGINAL
// message, argument extraction for step 3 (Jared Padalecki) would have no
// way to know it should target Padalecki specifically instead of Ackles or
// the show itself — it would either miss, or resolve against stale/wrong
// context. Passing the main model's own fresh atomic instruction is what
// makes each step's argument extraction correct.

export async function resolveAgentToolCall(
    agentInstruction: string,    // THIS ROUND's atomic instruction, written fresh
                                  // by the main model (e.g. "Search the web for
                                  // Jensen Ackles") — NOT the original user prompt.
                                  // Treated exactly like a fresh user message: run
                                  // through the same Stage 2/3 pipeline shouldUseTools()
                                  // uses, just skipping Stage 0/1 (we already know a
                                  // tool is needed — that's WHY this function was called).
    agentContext: string,        // rolling tool history built by agentLoop, for extra
                                  // grounding only (e.g. "Round 1: called internet_search
                                  // for 'Supernatural TV series' → success")
    alreadyCalled: Set<string>   // tools already executed EARLIER THIS EXACT instruction
                                  // (defensive de-dup within one resolve call — the
                                  // per-round "don't repeat the last tool" logic lives
                                  // in agentLoop.ts via a fresh Set per instruction)
): Promise<ToolCall[]> {

    const AGENT_CONTEXT_CHAR_LIMIT = 1800;
    const trimmedContext = agentContext.trim();
    const contextForRouter =
        trimmedContext.length > AGENT_CONTEXT_CHAR_LIMIT
            ? "…" + trimmedContext.slice(-AGENT_CONTEXT_CHAR_LIMIT)
            : trimmedContext;

    console.log(
        `[ROUTER][AGENT] Resolving instruction: "${agentInstruction}"` +
        ` | alreadyCalled=[${[...alreadyCalled].join(", ")}]`
    );

    // ── Stage 2 — regex on THIS ROUND'S instruction ──────────────────────────
    // Critically: matchPatterns runs on agentInstruction (the fresh, atomic,
    // single-purpose sentence the main model just wrote for this exact step),
    // never on the original multi-part user prompt. That's what makes each
    // step's argument extraction accurate instead of stale/reused.
    const patternResult = matchPatterns(agentInstruction);

    let resolvedByRegex: ToolCall[] = [];
    let unresolvedMatches: PatternMatch[] = [];
    let ambiguousReason: string | null = null;

    if (patternResult.status === "clean") {
        for (const match of patternResult.matches) {
            if (alreadyCalled.has(match.tool)) {
                console.log(`[ROUTER][AGENT][STAGE2] Skipping '${match.tool}' — already called.`);
                continue;
            }
            const call = regexCanFullyResolve(match, agentInstruction);
            if (call) {
                resolvedByRegex.push(call);
            } else {
                unresolvedMatches.push(match);
            }
        }
    } else if (patternResult.status === "ambiguous") {
        ambiguousReason = patternResult.reason;
        unresolvedMatches = patternResult.matches.filter(m => !alreadyCalled.has(m.tool));
    }
    // status === "none" → both arrays stay empty

    console.log(
        `[ROUTER][AGENT][STAGE2] status=${patternResult.status}` +
        ` resolved=[${resolvedByRegex.map(t => t.tool).join(", ")}]` +
        ` unresolved=[${unresolvedMatches.map(m => m.tool).join(", ")}]` +
        (ambiguousReason ? ` reason="${ambiguousReason}"` : "")
    );

    // Clean regex resolution with zero leftover ambiguity → skip Stage 3.
    if (
        patternResult.status === "clean" &&
        unresolvedMatches.length === 0 &&
        resolvedByRegex.length > 0
    ) {
        const finalTools = dedupe(resolvedByRegex);
        console.log(`[ROUTER][AGENT] Stage 2 resolved cleanly → [${finalTools.map(t => t.tool).join(", ")}]`);
        return finalTools;
    }

    // ── Stage 3 — LFM fill-in (lfm2.5-thinking:1.2b, native tool-calling) ────
    // agentInstruction is passed as the actual "prompt" the LFM sees — same
    // role `prompt` plays in shouldUseTools()'s Stage 3 call. This is what
    // makes the LFM's argument extraction accurate per-step: it's reading
    // "Search the web for Jensen Ackles" as if a user just typed exactly
    // that, not trying to re-derive step 5 of 5 from the original message.
    console.log(`[ROUTER][AGENT][STAGE3] Calling LFM (${ROUTER_MODEL}) on instruction: "${agentInstruction}"`);

    const stage3Tools = await stage3FillIn(
        agentInstruction,
        contextForRouter,
        "",             // no attachment hint inside agent loop
        resolvedByRegex,
        unresolvedMatches,
        ambiguousReason
    );

    const filteredStage3 = stage3Tools.filter(t => !alreadyCalled.has(t.tool));

    const finalTools = dedupe([...resolvedByRegex, ...filteredStage3]);

    console.log(`[ROUTER][AGENT][STAGE3] Resolved → [${finalTools.map(t => t.tool).join(", ")}]`);
    return finalTools;
}