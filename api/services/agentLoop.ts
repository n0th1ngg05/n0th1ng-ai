// ─────────────────────────────────────────────────────────────────────────────
// agentLoop.ts
//
// Multi-round agentic tool-use loop for the "Extended Thinking" toggle.
//
// ARCHITECTURE:
//
//   Round N:
//     1. Main model reasons in plain text, then either:
//        (a) writes a fence containing ONE atomic, self-contained,
//            plain-English instruction describing exactly what it wants
//            done next (e.g. "Search the web for Jensen Ackles") — phrased
//            as if it were the user typing that one request, or
//        (b) writes its final answer in plain text (no fence at all).
//     2. If an instruction was found:
//        → resolveAgentToolCall() (toolRouter.ts) treats it EXACTLY like a
//          fresh user message and runs it through the same Stage 2 (regex)
//          + Stage 3 (LFM native function-calling) pipeline shouldUseTools()
//          uses — just skipping Stage 0/1, since we already know an action
//          is needed. The LFM (lfm2.5-thinking:1.2b, fine-tuned for function
//          calling) decides the tool AND extracts the arguments.
//        → The main model NEVER generates a tool name or JSON — it only
//          ever writes a plain sentence. This is what eliminates hallucinated
//          arguments and malformed JSON: there's no JSON for the main model
//          to get wrong in the first place.
//        → The resolved tool(s) execute, results fold into the transcript,
//          loop continues to round N+1.
//     3. If no instruction was found → main model's visible text is the
//        final answer, loop ends.
//
// WHY A FRESH INSTRUCTION PER ROUND, NOT THE ORIGINAL USER PROMPT:
//   A multi-part request like "search X, then search Y and Z individually,
//   then save a preference" needs several DIFFERENT tool calls with
//   DIFFERENT arguments. If the router re-ran Stage 2/3 against the
//   original message every round, there'd be no way to tell step 3
//   ("look up Z") apart from step 2 ("look up Y") — both would resolve
//   against the same stale text. Passing the main model's own fresh,
//   round-specific instruction is what makes each step's argument
//   extraction accurate. See toolRouter.ts's resolveAgentToolCall() for
//   the full rationale.
//
// FENCE FORMAT (a plain sentence, not JSON):
//
//   ```tool_call
//   Search the web for Jensen Ackles
//   ```
//
// NO ROUND CAP: the model decides when to stop taking actions.
// ─────────────────────────────────────────────────────────────────────────────

import { executeTool, type ExecutionResult } from "./toolExecutor";
import { toolsForRouterPrompt } from "./tools";
import { resolveAgentToolCall } from "./toolRouter";
import type { ToolCall } from "./toolSelector";
import { PhaseTrackerService } from "./phaseTracker";
import { buildTemporalContext } from "../lib/temporalContext";
import { isOpenRouterModel, streamOpenRouterGenerate, streamOpenRouterTyped } from "./openRouter";

const OLLAMA_GENERATE_URL = "http://localhost:11434/api/generate";
const OLLAMA_CHAT_URL     = "http://localhost:11434/api/chat";
const OLLAMA_SHOW_URL     = "http://localhost:11434/api/show";

// ── Thinking-capability detection ───────────────────────────────────────────
// Ollama's behavior for `think: true` on a model that doesn't support
// reasoning is NOT uniform: some models (observed: qwen3 family) silently
// no-op the flag, but others (observed: ministral-3:8b) hard-reject the
// whole request with a 400 -- "\"ministral-3:8b\" does not support thinking".
// Sending think:true unconditionally therefore isn't safe for every model,
// but we also can't just drop the flag globally: deepseek-r1 (and other
// reasoning models outside the qwen3 prefix) rely on it being set, per the
// note on the main round call below.
//
// Fix: ask Ollama itself whether a model supports thinking (`/api/show`
// exposes this via `capabilities`), cache the answer per model name, and
// only set `think: true` on the request when the model actually supports
// it. This avoids the guesswork of a hardcoded model-name allowlist, which
// is exactly the brittle pattern that caused deepseek-r1 to be missed
// before (see comment at the main round call).
const thinkingSupportCache = new Map<string, boolean>();

async function modelSupportsThinking(model: string): Promise<boolean> {
  if (thinkingSupportCache.has(model)) {
    return thinkingSupportCache.get(model)!;
  }

  try {
    const res = await fetch(OLLAMA_SHOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });

    if (!res.ok) {
      // /api/show failing tells us nothing about thinking support either
      // way. Default to false (safe side: worst case a reasoning model
      // loses its think:true, which degrades gracefully -- its reasoning
      // just comes through as normal response tokens -- rather than a
      // hard 400 that kills the whole call).
      console.warn(
        `[AGENT][CAPABILITIES] /api/show returned ${res.status} for '${model}' -- assuming no thinking support.`
      );
      thinkingSupportCache.set(model, false);
      return false;
    }

    const data: any = await res.json().catch(() => null);
    const capabilities: string[] = Array.isArray(data?.capabilities) ? data.capabilities : [];
    const supportsThinking = capabilities.includes("thinking");

    console.log(
      `[AGENT][CAPABILITIES] '${model}' thinking support: ${supportsThinking} (capabilities: [${capabilities.join(", ")}])`
    );
    thinkingSupportCache.set(model, supportsThinking);
    return supportsThinking;
  } catch (err) {
    console.warn(
      `[AGENT][CAPABILITIES] Failed to query /api/show for '${model}':`, err,
      "-- assuming no thinking support."
    );
    thinkingSupportCache.set(model, false);
    return false;
  }
}

// ── Option 2: schema-constrained decision call ─────────────────────────────
// Fires ONLY when the free-form generation produced no usable instruction
// through the fence or either text-scanning fallback (prose / plain-fence,
// including the thinking-channel scan above). Rather than adding yet another
// text pattern to detect, this asks the SAME model the same question again,
// but with Ollama's `format` JSON-schema constraint applied — the sampler
// is mechanically restricted to only emit tokens that keep the output
// schema-valid, so there is no fence to fail to close and no format drift
// to pattern-match for. This is a last-resort layer, not a replacement for
// the fence: the fence path is cheap (no second model call) and correct
// the overwhelming majority of the time, so we only pay for this when
// everything else has already failed to find a signal.
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    instruction: {
      type: ["string", "null"],
      description:
        "ONE atomic, self-contained, plain-English instruction describing " +
        "the single next action to take (phrased as if the user typed it), " +
        "or null if enough information is already available to give a final answer.",
    },
  },
  required: ["instruction"],
} as const;

const DECISION_TIMEOUT_MS = 30_000;

/**
 * Ask the model to state its decision as schema-constrained JSON instead of
 * a markdown fence. Returns null on any failure (timeout, HTTP error,
 * unparseable output) — callers must treat null as "no signal", not as
 * "confirmed final answer", since this is a best-effort last resort, not
 * a guaranteed source of truth.
 */
async function resolveInstructionViaSchema(
  transcript: string,
  round: number,
  timezone?: string | null
): Promise<{ instruction: string | null } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);

  try {
    const response = await fetch(OLLAMA_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "lfm2.5:8b",
        messages: [
          {
            role: "system",
            content:
              "You already reasoned through this request in a prior generation " +
              "but did not produce a clear next step in the expected format. " +
              "Based on everything below, decide: is there one more concrete " +
              "action needed, or is enough information already available to " +
              "answer the user? Respond with the instruction field only.\n\n" +
              buildTemporalContext({ timezone }),
          },
          { role: "user", content: transcript },
        ],
        stream: false,
        format: DECISION_SCHEMA,
        options: { temperature: 0.1, num_predict: 512 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`[AGENT][ROUND ${round}] Schema-decision call HTTP ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const content = data?.message?.content ?? "";
    if (!content.trim()) return null;

    const parsed = JSON.parse(content) as { instruction?: string | null };
    const instruction = typeof parsed.instruction === "string" ? parsed.instruction.trim() : null;
    return { instruction: instruction || null };
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") {
      console.warn(`[AGENT][ROUND ${round}] Schema-decision call error:`, err);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Event types streamed back to boot.ts's route handler ──────────────────

export type AgentEvent =
  | { round: number }
  | { thinking: string }
  | { tool_call: { tool: string; arguments: Record<string, string> } }
  | { tool_result: { tool: string; success: boolean; result?: any; error?: string } }
  | { response: string }
  | { status: string }
  | { error: string }
  // Post-loop synthesis pass (see synthesizeExecutionSummary below).
  // Deliberately its own event shape rather than reusing `response` —
  // `response` means "this is the live final answer", which the frontend
  // may treat as THE answer bubble. The synthesis pass runs afterward, on
  // its own separate non-tool-calling model call, and produces a longer
  // recap of the whole run; keeping it as a distinct event lets the
  // frontend render it as a clearly separate "here's what happened" block
  // instead of silently appending to or replacing the real final answer.
  | { summary_chunk: string }
  | { summary_done: { summary: string } };

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

// ── Fence constants ────────────────────────────────────────────────────────

const FENCE_OPEN  = "```tool_call";
const FENCE_CLOSE = "```";

// ── Fence content = a plain instruction sentence, not JSON ─────────────────
// The fence no longer carries {"tool": "..."} JSON at all. It carries ONE
// atomic, self-contained natural-language instruction — exactly what the
// main model wants done next, phrased as if a user typed it themselves —
// e.g. "Search the web for Jensen Ackles". resolveAgentToolCall() (in
// toolRouter.ts) runs that sentence through the same Stage 2/3 pipeline a
// real user message goes through, so it decides the tool AND extracts the
// arguments — the main model never touches tool names or JSON at all.
//
// This is deliberately simpler to parse than JSON: anything non-empty
// between the fences IS the instruction. No JSON.parse, no key names, no
// malformed-JSON edge cases to handle.

// A real router instruction is a single sentence describing one action —
// "Search the web for X", "Save to memory: Y". It should never legitimately
// run to hundreds of characters. When it does, that's almost always the
// model dumping its whole multi-step plan inside the fence instead of one
// atomic instruction (observed: 1400+ chars, multiple bullet points, and a
// stray embedded ``` that closed the fence early). Forwarding that blob to
// Stage 3 forces LFM to gamble on extracting one real action from noise —
// it can get lucky, but it's not reliable. Instead, take only the first
// line/sentence and warn loudly so this failure mode is visible rather than
// silently "mostly working."
const MAX_PLAUSIBLE_INSTRUCTION_CHARS = 220;

function extractInstruction(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.length <= MAX_PLAUSIBLE_INSTRUCTION_CHARS) {
    return trimmed;
  }

  // Oversized — the model likely wrote a plan, not an instruction. Take the
  // first line (or first sentence if the first line is itself too long) as
  // a best-effort recovery, rather than forwarding the whole thing.
  const firstLine = trimmed.split("\n")[0].trim();
  const candidate = firstLine.length > 0 && firstLine.length <= MAX_PLAUSIBLE_INSTRUCTION_CHARS
    ? firstLine
    : (trimmed.match(/^[^.!?]*[.!?]/)?.[0].trim() ?? trimmed.slice(0, MAX_PLAUSIBLE_INSTRUCTION_CHARS).trim());

  console.warn(
    `[AGENT] Fence content was ${trimmed.length} chars (max plausible instruction is ` +
    `${MAX_PLAUSIBLE_INSTRUCTION_CHARS}) — this looks like a plan dump, not one instruction. ` +
    `Recovered first line/sentence as the instruction: "${candidate}". Full content discarded.`
  );

  return candidate.length > 0 ? candidate : null;
}

// ── Prose fallback ──────────────────────────────────────────────────────
// Some models bypass the fence entirely and just narrate what they want in
// plain prose without any fence markers at all (e.g. "I should search the
// web for Jensen Ackles now."). There's no fixed grammar to extract an
// "instruction" from arbitrary prose, so the fallback here is intentionally
// narrow: it only fires on an explicit, easy-to-recognize marker phrase, so
// we don't misfire on a normal answer that happens to mention a tool name
// in passing. Everything else without a real fence is treated as a genuine
// final answer, same as before.

const PROSE_INSTRUCTION_PATTERN = /(?:i(?:'ll| will|'m going to)?\s+(?:now\s+)?(?:need to |want to )?(search|look up|check|calculate|save|store|remember)\b.*)/i;

function tryExtractInstructionFromProse(text: string): { instruction: string; patternUsed: string } | null {
  const match = text.match(PROSE_INSTRUCTION_PATTERN);
  if (match) {
    return { instruction: match[0].trim(), patternUsed: "prose (narrated intent)" };
  }
  return null;
}

// ── Plain-fence fallback ─────────────────────────────────────────────────
// Some models (notably deepseek-r1) use plain ``` fences without the
// `tool_call` tag, putting a shell-command-style instruction inside, e.g.:
//
//   Search the web for The Boys:
//   ```
//   knowledge_search "The Boys TV series"
//   ```
//
// The FenceWatcher only opens on ```tool_call, so these slip through entirely.
// This fallback fires ONLY when no fence was detected at all, and looks for:
//   (A) A clear action heading immediately before a plain ``` block, e.g.
//       "Search the web for The Boys:" — the heading IS the instruction.
//   (B) The content inside the plain ``` block matching a known tool command,
//       which is then converted to a natural-language instruction for the router.
//
// Deliberately conservative: skips blocks whose content looks like real code
// (has JS/Python keywords) and requires the heading or content to contain an
// action verb — so a normal answer with an embedded code example won't fire.

// Matches any ``` block that does NOT have the tool_call language tag.
// Uses 'g' flag; iterate with matchAll.
const PLAIN_FENCE_RE = /```(?!tool_call\b)[^`\n]*\n([\s\S]*?)```/g;

// Matches "[Action heading]:" immediately before a plain ``` block.
// Only fires when the heading contains a known action verb.
const ACTION_HEADING_RE = /((?:Search|Look up|Find|Save|Store|Research|Read)[^:\n]{0,100}):\s*\n```/gi;

// Tool command → natural-language instruction converter.
// Keeps the router's Stage 2/3 path clean: it always sees plain English.
const TOOL_COMMAND_TO_NL: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^knowledge_search\s+["']?(.+?)["']?\s*$/i, (m) => `Search my knowledge base for ${m[1]}`],
  [/^internet_search\s+["']?(.+?)["']?\s*$/i,  (m) => `Search the web for ${m[1]}`],
  [/^file_search\s+["']?(.+?)["']?\s*$/i,      (m) => `Search my files for ${m[1]}`],
  [/^research_query\s+["']?(.+?)["']?\s*$/i,   (m) => `Research ${m[1]}`],
  [/^url_reader\s+["']?(.+?)["']?\s*$/i,       (m) => `Read the URL ${m[1]}`],
  [/^memory_store\s+["']?(.+?)["']?/i,         (m) => `Save to my preferences: ${m[1]}`],
  [/^memory_search\s+["']?(.+?)["']?\s*$/i,    (m) => `Search my memories for ${m[1]}`],
];

function tryExtractInstructionFromPlainFences(
  text: string
): { instruction: string; patternUsed: string } | null {

  // ── (A) Action heading before a ``` block ──────────────────────────────
  // e.g. "Search the web for The Boys:\n```\n...\n```"
  // Reset lastIndex before iterating.
  ACTION_HEADING_RE.lastIndex = 0;
  for (const m of text.matchAll(ACTION_HEADING_RE)) {
    const heading = m[1].trim();
    if (heading.length === 0 || heading.length > 200) continue;

    // Verify the fence content after the heading isn't real code.
    const afterHeadingFence = text.slice((m.index ?? 0) + m[0].length);
    const contentMatch = afterHeadingFence.match(/^([\s\S]*?)```/);
    const fenceContent = contentMatch?.[1]?.trim() ?? "";
    if (/\b(const|let|var|function|class|import|export)\b/.test(fenceContent)) continue;

    console.log(`[AGENT] Plain-fence fallback: action heading matched → "${heading}"`);
    return { instruction: heading, patternUsed: "action-heading-before-fence" };
  }

  // ── (B) Known tool command inside a ``` block ──────────────────────────
  PLAIN_FENCE_RE.lastIndex = 0;
  for (const m of text.matchAll(PLAIN_FENCE_RE)) {
    const content = m[1].trim();
    if (!content || content.length > 300) continue;

    // Skip actual code.
    if (/\b(const|let|var|function|class|import|export)\b/.test(content)) continue;

    for (const [pattern, converter] of TOOL_COMMAND_TO_NL) {
      const cmdMatch = content.match(pattern);
      if (cmdMatch) {
        const instruction = converter(cmdMatch);
        console.log(`[AGENT] Plain-fence fallback: tool command matched → "${instruction}"`);
        return { instruction, patternUsed: "plain-fence tool command" };
      }
    }

    // ── (C) Natural-language action inside a ``` block ────────────────────
    if (
      content.length < 200 &&
      /\b(search|find|look up|save|store|remember|calculate|research)\b/i.test(content) &&
      !/\n/.test(content)   // single-line only — multi-line is likely a code block
    ) {
      console.log(`[AGENT] Plain-fence fallback: NL action in fence → "${content}"`);
      return { instruction: content, patternUsed: "plain-fence natural language" };
    }
  }

  return null;
}

// ── System prompt ──────────────────────────────────────────────────────────

function buildAgentSystemPrompt(toolCatalog: string, baseContext: string, timezone?: string | null): string {
  return `
You are n0th1ng AI, running in Extended Thinking mode. You can take actions as
many times as needed, one at a time, reasoning between each action, before
giving your final answer.

${buildTemporalContext({ timezone })}

${baseContext}

==================================================
TOOLS AVAILABLE TO THE SYSTEM
==================================================

The following tools show what the system is capable of — for your awareness
only. You do NOT pick which tool to use, and you NEVER write a tool function
name (knowledge_search, internet_search, memory_store, etc.) in your fence.
Your fence contains ONLY a plain-English instruction describing what you want
done; the system automatically selects the right tool. Naming a tool yourself
in the fence is always wrong — the routing is the system's job, not yours.

${toolCatalog}

==================================================
HOW TO TAKE AN ACTION
==================================================

You do NOT call tools directly and you do NOT write JSON. When you need
information or need to do something (search the web, check the knowledge
base, save a memory, run a calculation, etc.), write ONE clear, complete,
self-contained instruction — in plain English, exactly as if YOU were the
user asking for that one specific thing — inside a fence, then STOP:

\`\`\`tool_call
<your one-sentence instruction here>
\`\`\`

If the user's request has multiple parts (e.g. "search X, then search Y and
Z individually, then save a preference"), you may THINK THROUGH the whole
plan in plain text BEFORE the fence — that's encouraged, it's how you keep
track of what's left. But the fence itself must contain ONLY the single next
instruction, nothing else — no plan, no bullet list, no "then also", no
markdown, no other fences. Planning goes in your visible reasoning; the
fence is just the one action.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WORKED EXAMPLE — multi-part request handled correctly across several rounds:

User asked: "Search for Supernatural, then search each main cast member
individually, then save that I like the show."

Round 1 — you think through the plan, then act on step 1 only:
  My plan: (1) search for the show itself, (2) search each cast member one
  by one once I know who they are, (3) save the preference. Starting with
  step 1.

  \`\`\`tool_call
  Search the web for the TV series Supernatural
  \`\`\`

Round 2 — result came back naming the cast. Act on ONE cast member:
  \`\`\`tool_call
  Search the web for Jared Padalecki
  \`\`\`

Round 3 — next cast member:
  \`\`\`tool_call
  Search the web for Jensen Ackles
  \`\`\`

...continue one at a time for each remaining cast member, THEN:

Round N — all searches done, now save the preference:
  \`\`\`tool_call
  Save to memory: the user's favorite web series is Supernatural
  \`\`\`

Round N+1 — everything is done, give the final answer as plain text with NO
fence:
  I searched for Supernatural and its main cast (Jared Padalecki, Jensen
  Ackles, ...) and saved your preference for the show.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INCORRECT — planning content stuffed inside the fence:

\`\`\`tool_call
Internet Search Query: Supernatural Webseries

Next, individually search each main cast member of "Supernatural"...
(more plan text, bullet points, etc.)
\`\`\`

The fence is not a scratchpad. Put the plan in plain text BEFORE the fence;
the fence itself holds only the one instruction for THIS round.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL — wrong fence type (plain \`\`\` does NOTHING):

WRONG — the system cannot see plain fences at all. This is silently ignored:

  The Boys is a TV series about... [do not write facts you haven't searched for]
  Search the web for The Boys:
  \`\`\`
  internet_search "The Boys TV series"
  \`\`\`

This is wrong for TWO reasons:
  1. A plain \`\`\` fence (without the word tool_call after it) is treated as
     a markdown code block — the system cannot see it as a tool call and takes
     no action whatsoever. Your generation is completely wasted.
  2. Writing facts about the topic before searching makes them hallucinated.
     In round 1 you have no data — do not state anything about the subject
     until you have real tool results to cite.

CORRECT — plan in plain text, then emit the \`\`\`tool_call fence:

  My plan: (1) search for The Boys, (2) search each cast member one by one,
  (3) save the preference. Starting step 1.
  \`\`\`tool_call
  Search the web for the TV series The Boys
  \`\`\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INCORRECT — naming a tool function inside the fence:

  \`\`\`tool_call
  knowledge_search "The Boys TV series"
  \`\`\`

WRONG: you chose the tool. You are not allowed to name tools — the system
decides automatically. Describe what you want in plain English:

CORRECT:
  \`\`\`tool_call
  Search for information about the TV series The Boys
  \`\`\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INCORRECT — vague follow-up after getting a result with specific names:

  (Round 1 returned cast names: Karl Urban, Jack Quaid, Antony Starr...)
  Round 2 fence:
  \`\`\`tool_call
  Search the web for each cast member's information
  \`\`\`

WRONG: the routing system sees ONLY this sentence — it has no access to
previous results. "each cast member" is unresolvable.

CORRECT — extract actual names from the result, one per round:

  Round 2: \`\`\`tool_call
  Search the web for Karl Urban actor
  \`\`\`
  Round 3: \`\`\`tool_call
  Search the web for Jack Quaid actor
  \`\`\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULES:
- The fence must contain ONLY the instruction sentence — no JSON, no tool
  names, no "arguments", no quotes-as-code, no plan, no bullet points,
  nothing else.
- CRITICAL fence tag: the opening line MUST be \`\`\`tool_call (with the words
  "tool_call" immediately after the backticks, no space before them). A plain
  \`\`\` without tool_call is a code block — the system ignores it entirely.
- NEVER name a tool in your fence. The fence must describe what you want in
  plain English only — "Search the web for X", "Save to memory: I like X" —
  never a function name like knowledge_search, internet_search, memory_store.
  You do NOT decide the tool; the system routes your instruction automatically.
- Do NOT state any facts about the topic of the user's request before you
  have tool results. In round 1 you have no data at all — anything you write
  about the subject is fabricated. Think/plan in plain text, then go
  straight to the \`\`\`tool_call fence.
- ONE atomic instruction per fence. Handle multi-part requests ONE STEP AT A
  TIME across multiple rounds, as in the worked example above.
- CRITICAL — specific instructions only: after a tool result gives you specific
  names, values, or items that determine your next step (e.g. a cast list), your
  next instruction MUST include the actual specific value extracted from that
  result, not a vague placeholder. Write "Search the web for Karl Urban actor"
  NOT "search for the cast member". The routing system sees ONLY your single
  instruction sentence and has no memory of previous results, so any reference
  like "the actor", "each cast member", or "that value" is completely
  unresolvable to it. If you need N actions for N items, do them one round at
  a time, naming each item explicitly.
- Make each instruction fully self-contained. Do not write vague things like
  "search for it" or "look that up" — name the actual subject, e.g. "Search
  the web for Jared Padalecki", not "search for the second actor".
- CRITICAL: emit AT MOST ONE \`\`\`tool_call fence per generation, then STOP
  completely — no second fence, no matter how many steps remain. You get
  another turn immediately after seeing the result, so there's no reason to
  try to fit more than one in.
- If your thinking already reasoned through what to do next — including
  naming a specific next search, value, or action — that conclusion goes
  STRAIGHT into the fence, verbatim, as your very next output. Do not
  follow a clear internal conclusion with second-guessing, hedging, or a
  vague clarifying question. If you catch yourself thinking something like
  "perhaps the user wants..." or "alternatively, maybe I should ask..."
  after you already identified the concrete next step, ignore that impulse
  and just act on the concrete step you identified.
- If the user's request has multiple steps and they are NOT all finished
  yet, you MUST do one of two things — never just trail off or ask a vague
  open-ended question:
    (a) emit your next single \`\`\`tool_call instruction, or
    (b) if you are genuinely blocked (e.g. a required detail is missing and
        cannot be inferred), ask the user ONE specific, answerable question
        as your final answer.
  Writing something like "could you clarify what details you'd like?" when
  the task is already fully specified is not acceptable — the example above
  IS fully specified (search show, search each cast member, save
  preference), so continue executing it rather than asking the user to
  re-explain it.
- When every action the user asked for is actually finished — not before —
  give your final answer in plain text with NO \`\`\`tool_call fence
  anywhere. That's how the system knows you're done.
- Never fabricate a result yourself. Only real results the system gives you
  back count.
- Remember this, after every round: if you have a clear next step, put it in the fence. If you are blocked and cannot proceed, ask the user ONE specific question to unblock you. Do not trail off, do not ask vague open-ended questions, do not try to summarize or explain what you've done so far — just act on the next step or ask one clear question.
- You need to put the next step in the fence, or the tool call won't happen. So after every round, if you have a clear next step, put it in the fence. Do not ask the user to clarify or summarize what you've done so far — just act on the next step.  

Think naturally between steps — it's fine to reason in plain text before
deciding on your next instruction or giving your final answer.
`.trim();
}

// ── Streaming fence-aware token watcher ───────────────────────────────────
// Watches the live Ollama token stream for a ```tool_call fence. Text before
// and after (if any) is forwarded as visible response tokens. Content inside
// the fence is buffered silently and treated as a plain instruction sentence
// — no JSON parsing at all, just "is there non-empty text in the fence".

interface FenceWatcherResult {
  instruction: string | null;    // first instruction, if any (still one-per-round contract)
  extraInstructions: string[];   // any additional fences the model shouldn't have emitted
  malformed: boolean;            // fence found but empty/whitespace-only
  fenceFound: boolean;
}

// FENCE_CLOSE must appear at the start of its own line to count as a real
// close. Bare ``` alone is the single most common markdown sequence a model
// can produce — inline code examples, quoted snippets, leftover markdown
// habit while narrating a plan — so treating ANY ``` anywhere as a close
// (as this used to do) means the model's own planning prose can accidentally
// truncate its instruction the moment it writes an unrelated code example.
// Requiring the close to be line-anchored matches how a model INTENDING to
// close a fenced code block actually writes it, and is far less likely to
// trigger by accident. Ollama itself has no concept of "the real closing
// fence" — it's just a token stream — so this has to be enforced here.
const FENCE_CLOSE_LINE = /(^|\n)[ \t]*```/;

class FenceWatcher {
  private buffer      = "";
  private inFence     = false;
  private fenceBuffer = "";
  private sawFence    = false;
  private instructions: string[] = [];
  private malformed   = false;
  private _fullText   = "";

  constructor(
    private readonly onText: (text: string) => void | Promise<void>,
    private readonly round: number
  ) {}

  get fullText(): string { return this._fullText; }

  async push(token: string): Promise<void> {
    this.buffer += token;

    while (true) {
      if (!this.inFence) {
        const idx = this.buffer.indexOf(FENCE_OPEN);
        if (idx === -1) {
          const holdBack = Math.min(this.buffer.length, FENCE_OPEN.length - 1);
          const safeToEmit = this.buffer.slice(0, this.buffer.length - holdBack);
          if (safeToEmit) {
            this._fullText += safeToEmit;
            await this.onText(safeToEmit);
          }
          this.buffer = this.buffer.slice(this.buffer.length - holdBack);
          return;
        }

        // Emit any text before the fence, enter fence-buffering mode.
        const before = this.buffer.slice(0, idx);
        if (before) {
          this._fullText += before;
          await this.onText(before);
        }
        this.buffer   = "\n" + this.buffer.slice(idx + FENCE_OPEN.length);
        // ^ Synthetic leading \n so the true start of fence content counts
        // as a valid line-start for FENCE_CLOSE_LINE's (^|\n) anchor. This
        // matters if the model's instruction is followed immediately by the
        // closing ``` with no blank line before it. Note: a fence with ZERO
        // newlines anywhere (instruction and close both glued onto the same
        // line as ```tool_call) still won't match — that's fine, it falls
        // through to finish()'s "fence opened but never closed" / malformed
        // path, which is a safe, visible failure rather than a silent one.
        this.inFence  = true;
        this.sawFence = true;
        console.log(`[AGENT][ROUND ${this.round}] Fence opened — buffering instruction`);
        continue;
      }

      // Inside the fence — wait for a closing ``` that starts its own line
      // (see FENCE_CLOSE_LINE comment above for why bare indexOf was wrong).
      const closeMatch = FENCE_CLOSE_LINE.exec(this.buffer);
      if (!closeMatch) {
        // No confirmed close yet. Hold back a small tail in case a close
        // sequence is currently split across this chunk and the next one
        // (e.g. buffer ends "...\n``" and the next token starts with "`").
        const holdBack = Math.min(this.buffer.length, FENCE_CLOSE.length + 1);
        this.fenceBuffer += this.buffer.slice(0, this.buffer.length - holdBack);
        this.buffer = this.buffer.slice(this.buffer.length - holdBack);
        return;
      }

      const matchStart = closeMatch.index + closeMatch[1].length; // skip the leading \n if present
      const matchEnd   = closeMatch.index + closeMatch[0].length;

      this.fenceBuffer += this.buffer.slice(0, matchStart);
      this.buffer   = this.buffer.slice(matchEnd);
      this.inFence  = false;

      const instruction = extractInstruction(this.fenceBuffer);
      this.fenceBuffer = "";

      if (instruction) {
        this.instructions.push(instruction);
        console.log(
          `[AGENT][ROUND ${this.round}] Fence closed — instruction="${instruction}"` +
          (this.instructions.length > 1 ? ` (fence #${this.instructions.length} this round)` : "")
        );
      } else {
        this.malformed = true;
        console.warn(`[AGENT][ROUND ${this.round}] Fence closed but was empty/whitespace-only.`);
      }
      // Keep scanning — a second fence in the same generation is a model
      // rule-violation (one instruction per round), not something to
      // silently swallow. We still only ACT on the first one (see finish()),
      // but we no longer let a later fence silently overwrite an earlier one.
      continue;
    }
  }

  async finish(): Promise<FenceWatcherResult> {
    if (!this.inFence && this.buffer) {
      this._fullText += this.buffer;
      await this.onText(this.buffer);
      this.buffer = "";
    }
    if (this.inFence) {
      const partial = this.fenceBuffer.trim();
      console.warn(
        `[AGENT][ROUND ${this.round}] Fence opened but never closed — treating as malformed` +
        (partial ? ` (${partial.length} chars buffered, discarded)` : " (no content buffered)")
      );
      return { instruction: this.instructions[0] ?? null, extraInstructions: this.instructions.slice(1), malformed: true, fenceFound: true };
    }
    if (this.instructions.length > 1) {
      console.warn(
        `[AGENT][ROUND ${this.round}] Model emitted ${this.instructions.length} fences in one generation ` +
        `(only one instruction is allowed per round) — acting on the FIRST, ` +
        `queuing the rest: ${JSON.stringify(this.instructions.slice(1))}`
      );
    }
    return {
      instruction:       this.instructions[0] ?? null,
      extraInstructions: this.instructions.slice(1),
      malformed:         this.sawFence && this.malformed,
      fenceFound:        this.sawFence,
    };
  }
}

// ── One round: call Ollama, stream response, detect tool-name signal ───────

interface RoundResult {
  text: string;
  instruction: string | null;   // atomic instruction for the router (no tool/args)
  extraInstructions: string[];  // additional fences the model shouldn't have emitted (see FenceWatcher)
  usedFallback: boolean;
}

async function runOneRound(
  model: string,
  prompt: string,
  emit: AgentEventSink,
  round: number
): Promise<RoundResult> {

  const promptChars = prompt.length;
  console.log(
    `[AGENT][ROUND ${round}] Sending prompt to Ollama` +
    ` — ~${Math.ceil(promptChars / 3.5)} est. tokens (${promptChars} chars)`
  );



  // Always request native thinking mode. Ollama silently no-ops this for
  // models that don't support it (no error, `thinking` field just never
  // populates) — so this is safe for every model, not just qwen3/qwen3.5.
  // Previously this was gated to a qwen3-only prefix allowlist, which meant
  // reasoning models outside that list (deepseek-r1:7b, and any future
  // reasoning model) never got think:true. For deepseek-r1 specifically,
  // that's not a minor miss: it reasons by default regardless of the flag,
  // so without think:true its reasoning tokens come through as ordinary
  // `response` tokens instead of a separate `thinking` field, get fed
  // straight into FenceWatcher below, and can leave a tool_call-shaped
  // fence dangling open for the entire generation — exactly the 21s/0-char
  // "fence opened but never closed" failure this was patched to fix.
  // num_predict: -1 removes Ollama's own (often short) default generation-
  // length cap. Without this, a verbose reasoning model like deepseek-r1 can
  // burn its entire predict budget on <think> content before ever reaching
  // a closing fence — the stream then ends on its own accord (not via our
  // GENERATE_TIMEOUT_MS/STALL_TIMEOUT_MS below), producing a fence that
  // "opened but never closed" despite plenty of time remaining. -1 lets the
  // model run until it naturally stops or hits its own context window,
  // instead of an arbitrary short cap cutting off mid-thought.
  const supportsThinking = await modelSupportsThinking(model);

  const payload: any = {
    model,
    prompt,
    stream: true,
    ...(supportsThinking ? { think: true } : {}),
    options: { num_predict: -1 },
  };

  const controller = new AbortController();
  const GENERATE_TIMEOUT_MS = 120_000;
  const timeoutId = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  // ── Route: OpenRouter or Ollama ────────────────────────────────────────
  // Now that timeoutId and GENERATE_TIMEOUT_MS are declared, it's safe to
  // branch on OpenRouter before making the Ollama fetch.
  if (isOpenRouterModel(model)) {
    clearTimeout(timeoutId);
    // OpenRouter path: stream typed tokens (response + thinking) through the
    // emit() sink. Extended-thinking models (Claude Sonnet 4.6 Thinking etc.)
    // surface reasoning in delta.reasoning; streamOpenRouterTyped yields those
    // as { type:'thinking' } so they reach the frontend's thinking box and get
    // accumulated into overallThinking for persistence — previously they were
    // silently dropped by the legacy generator which only read delta.content.
    const orController = new AbortController();
    const orTimeoutId = setTimeout(() => orController.abort(), GENERATE_TIMEOUT_MS);
    try {
      let visibleText = "";
      const fence = new FenceWatcher(async (text) => {
        if (!text) return;
        visibleText += text;
        await emit({ response: text });
      }, round);

      for await (const tok of streamOpenRouterTyped(model, prompt, undefined, orController.signal)) {
        if (tok.type === 'thinking') {
          // Forward reasoning trace to the frontend thinking box and let it
          // accumulate into overallThinking via the caller's existing logic.
          await emit({ thinking: tok.text });
        } else {
          // Visible response token — run through FenceWatcher so tool_call
          // fences embedded in the answer are detected and extracted.
          await fence.push(tok.text);
        }
      }
      const fenceResult = await fence.finish();
      clearTimeout(orTimeoutId);

      return {
        text: visibleText,
        instruction: fenceResult.instruction,
        extraInstructions: fenceResult.extraInstructions,
        usedFallback: false,
      };
    } catch (err) {
      clearTimeout(orTimeoutId);
      const isAbort = err instanceof Error && err.name === "AbortError";
      const msg = isAbort ? "OpenRouter timed out." : `OpenRouter error: ${String(err)}`;
      console.error(`[AGENT][ROUND ${round}] OpenRouter failed:`, msg);
      await emit({ error: msg });
      return { text: "", instruction: null, extraInstructions: [], usedFallback: false };
    }
  }

  let response: Response;
  try {
    response = await fetch(OLLAMA_GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = isAbort
      ? "Model backend timed out."
      : `Failed to reach model backend: ${String(err)}`;
    console.error(`[AGENT][ROUND ${round}] Ollama fetch failed:`, msg);
    await emit({ error: msg });
    return { text: "", instruction: null, extraInstructions: [], usedFallback: false };
  }
  clearTimeout(timeoutId);

  // Defensive fallback: even though modelSupportsThinking() should have
  // already excluded `think` for this model, if Ollama STILL 400s
  // specifically citing "does not support thinking" (e.g. capability cache
  // was stale after a model swap, or /api/show reported capabilities that
  // turned out to be wrong), retry once immediately without the flag
  // rather than losing the whole round to a swallowed error.
  if (!response.ok && response.status === 400 && payload.think) {
    const errText = await response.text().catch(() => "");
    if (errText.toLowerCase().includes("does not support thinking")) {
      console.warn(
        `[AGENT][ROUND ${round}] '${model}' rejected think:true despite capability check ` +
        `(cache was stale?) -- retrying without it and updating the cache.`
      );
      thinkingSupportCache.set(model, false);
      delete payload.think;

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), GENERATE_TIMEOUT_MS);
      try {
        response = await fetch(OLLAMA_GENERATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: retryController.signal,
        });
      } catch (err) {
        clearTimeout(retryTimeoutId);
        const isAbort = err instanceof Error && err.name === "AbortError";
        const msg = isAbort
          ? "Model backend timed out on retry."
          : `Failed to reach model backend on retry: ${String(err)}`;
        console.error(`[AGENT][ROUND ${round}] Ollama retry fetch failed:`, msg);
        await emit({ error: msg });
        return { text: "", instruction: null, extraInstructions: [], usedFallback: false };
      }
      clearTimeout(retryTimeoutId);
    }
  }

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    console.error(`[AGENT][ROUND ${round}] Ollama returned ${response.status}:`, errText);
    await emit({ error: `Model backend returned ${response.status}: ${errText}` });
    return { text: "", instruction: null, extraInstructions: [], usedFallback: false };
  }

  let visibleText = "";
  const fence = new FenceWatcher(async (text) => {
    if (!text) return;
    visibleText += text;
    await emit({ response: text });
  }, round);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let inThinkBlock = false;
  let thinkBuffer  = "";
  // Every thinking-channel chunk, concatenated across the whole generation.
  // Some models (observed: lfm2.5:8b) occasionally write their entire plan
  // AND the closing ```tool_call fence inside the `thinking` field instead
  // of ever transitioning to `response` tokens. FenceWatcher only ever sees
  // `response` tokens (see fence.push(token) below), so a fence buried in
  // thinking was previously invisible to every detection layer — including
  // the prose/plain-fence fallbacks, which only scanned fence.fullText /
  // visibleText. thinkFullText closes that blind spot; see its use in the
  // fallback chain below.
  let thinkFullText = "";

  const STALL_TIMEOUT_MS = 60_000;
  const readWithStallTimeout = (): ReturnType<typeof reader.read> =>
    Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`No data from model for ${STALL_TIMEOUT_MS}ms — stream stalled`)),
          STALL_TIMEOUT_MS
        )
      ),
    ]);

  let lastDoneReason: string | null = null;
  let lastEvalCount: number | null = null;

  try {
    while (true) {
      const { value, done } = await readWithStallTimeout();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: any;
        try { parsed = JSON.parse(line); } catch { continue; }

        if (parsed.error) {
          console.error(`[AGENT][ROUND ${round}] Ollama stream error:`, parsed.error);
          await emit({ error: String(parsed.error) });
          continue;
        }

        if (parsed.done) {
          lastDoneReason = parsed.done_reason ?? null;
          lastEvalCount  = typeof parsed.eval_count === "number" ? parsed.eval_count : null;
        }

        if (parsed.thinking) {
          await emit({ thinking: parsed.thinking });
          thinkFullText += parsed.thinking;
          continue;
        }

        const token: string = parsed.response ?? "";
        if (!token) continue;

        // <think>...</think> literal-tag fallback for models without native thinking.
        if (token.includes("<think>")) {
          inThinkBlock = true;
          const after = token.split("<think>")[1] ?? "";
          if (after) thinkBuffer += after;
          continue;
        }
        if (inThinkBlock) {
          if (token.includes("</think>")) {
            inThinkBlock = false;
            thinkBuffer += token.split("</think>")[0] ?? "";
            thinkFullText += thinkBuffer;
            await emit({ thinking: thinkBuffer });
            thinkBuffer = "";
            const after = token.split("</think>")[1] ?? "";
            if (after) await fence.push(after);
          } else {
            thinkBuffer += token;
          }
          continue;
        }

        await fence.push(token);
      }
    }
  } catch (err) {
    console.error(`[AGENT][ROUND ${round}] Stream read error:`, err);
    await emit({ error: err instanceof Error ? err.message : String(err) });
  }

  console.log(
    `[AGENT][ROUND ${round}] Ollama stream ended | done_reason=${lastDoneReason ?? "unknown"}` +
    (lastEvalCount !== null ? ` | eval_count=${lastEvalCount}` : "")
  );

  const { instruction, extraInstructions, malformed, fenceFound } = await fence.finish();

  if (malformed) {
    console.warn(`[AGENT][ROUND ${round}] Malformed fence (empty) — surfacing as status, treating as final answer`);
    await emit({ status: "Received an empty tool_call fence — treating this generation as a final answer." });
  }

  // ── Fallback chain (no tool_call fence seen) ─────────────────────────────
  // Runs only when no ```tool_call fence was seen at all. Tries three
  // progressively broader detection strategies before giving up:
  //   1. Prose: "I'll search for X" / "I need to look up X"
  //   2. Action heading before a plain ```: "Search the web for X:\n```\n..."
  //   3. Known tool command inside a plain ```: "knowledge_search \"X\""
  // Strategy 2 and 3 are the deepseek-r1 pattern: it forgets the tool_call
  // tag and uses plain backtick fences with shell-command-style content.
  if (!instruction && !fenceFound) {
    // Baseline: only the response channel. If the model actually produced
    // real visible output, trust that and don't go rummaging through its
    // thinking — a model can reason ABOUT fences ("I won't use one here")
    // without intending to emit one, and treating every mention of
    // ```tool_call in thinking as a real instruction would false-positive
    // on that case. Only fall through to thinking when response was
    // near-empty — the concrete signal that the model dumped its decision
    // into thinking and never transitioned to a response phase at all
    // (this is exactly what happened in the lfm2.5:8b round-2 failure:
    // eval_count=2266 tokens, but visibleText was empty).
    const responseText = fence.fullText || visibleText;
    const usingThinkingFallback = responseText.trim().length < 20 && thinkFullText.trim().length > 0;
    const fullText = usingThinkingFallback ? `${responseText}\n${thinkFullText}` : responseText;

    console.log(
      `[AGENT][ROUND ${round}] No fence detected in response — running fallback chain` +
      (usingThinkingFallback
        ? ` (response near-empty, ${thinkFullText.length} chars scanned from thinking channel too)`
        : "")
    );

    // 1. Prose narrated-intent fallback
    const proseFallback = tryExtractInstructionFromProse(fullText);
    if (proseFallback) {
      console.log(
        `[AGENT][ROUND ${round}] Fallback 1 (prose) matched (${proseFallback.patternUsed})` +
        ` — instruction="${proseFallback.instruction}"`
      );
      return { text: visibleText, instruction: proseFallback.instruction, extraInstructions: [], usedFallback: true };
    }

    // 2 + 3. Plain-fence fallback (action heading OR tool command inside ```)
    const plainFenceFallback = tryExtractInstructionFromPlainFences(fullText);
    if (plainFenceFallback) {
      console.log(
        `[AGENT][ROUND ${round}] Fallback 2 (plain-fence) matched (${plainFenceFallback.patternUsed})` +
        ` — instruction="${plainFenceFallback.instruction}"`
      );
      return { text: visibleText, instruction: plainFenceFallback.instruction, extraInstructions: [], usedFallback: true };
    }

    // 3. Last resort: schema-constrained decision call (Option 2). Only
    // reached when the model's free-form output — response AND, if it was
    // near-empty, thinking — contained no recognizable signal at all. This
    // costs one extra small, non-streamed model call, so it's deliberately
    // ordered last rather than replacing the cheap paths above.
    console.log(`[AGENT][ROUND ${round}] Fallbacks 1+2 found nothing — trying schema-constrained decision call`);
    const schemaDecision = await resolveInstructionViaSchema(fullText, round, timezone);
    if (schemaDecision?.instruction) {
      console.log(
        `[AGENT][ROUND ${round}] Fallback 3 (schema-constrained) matched` +
        ` — instruction="${schemaDecision.instruction}"`
      );
      return { text: visibleText, instruction: schemaDecision.instruction, extraInstructions: [], usedFallback: true };
    }

    console.log(`[AGENT][ROUND ${round}] No tool signal in generation, including schema-constrained check — treating as final answer`);
  }

  return { text: visibleText, instruction, extraInstructions, usedFallback: false };
}

// ── Post-loop synthesis pass ────────────────────────────────────────────────
// Runs strictly AFTER runAgentLoop() has already returned — never called from
// inside the while(true) loop, and does not touch FenceWatcher, the 3-stage
// router, or executeTool at all. That separation is deliberate: the whole
// point is a plain, tool-free generation that can't be mistaken for another
// round of the agent loop.
//
// Why this exists: the agent loop's `finalAnswer` is intentionally terse —
// it's whatever the main model happened to say once it stopped emitting
// tool-call fences (e.g. "I have recorded that you like Avengers: Endgame",
// 47 chars, after a 5-round run that searched, cross-referenced, and stored
// a memory). That's fine as the literal last line of the loop, but it's a
// poor stand-alone summary of everything that actually happened. This pass
// takes the full transcript (every instruction, every tool call, every tool
// result, in order) and asks the SAME model, in a fresh single-shot
// generation with no tool access, to write a proper recap: what was asked,
// what was done, what was found, and a clear answer — acknowledging each
// step rather than just the final line.
//
// This NEVER replaces finalAnswer. It's purely additive — a second, later
// piece of output the caller can display underneath/after the real final
// answer. If it fails for any reason (model unreachable, timeout, etc.),
// that failure must not affect the already-completed agent loop result in
// any way — errors are caught and swallowed here, with only a console
// warning and an { error } event, never thrown back to the caller.
export async function synthesizeExecutionSummary(
  model: string,
  userPrompt: string,
  transcript: string,
  emit: AgentEventSink
): Promise<string> {

  // Deliberately NOT reusing the agent system prompt (buildAgentSystemPrompt)
  // — that prompt exists to teach the model the ```tool_call fence format,
  // which is exactly what this pass must NOT produce. A separate, minimal
  // instruction set keeps this a plain writing task.
  const synthesisPrompt = `You just finished working through a multi-step request using various tools. Below is the complete internal record of that session: the original request, every instruction you issued, every tool call, and every tool result, in order.

You do NOT have access to any tools right now. Do not attempt to call any tool, and do not use \`\`\`tool_call or any similar fence — plain prose only.

Your job now is to write a clear, detailed, human-readable summary of the whole session for the person who asked the original question. Specifically:
- Briefly acknowledge each distinct part of what they originally asked for.
- Walk through what you actually did to address each part (what you searched for, what you found, what you stored, etc.) — enough detail that they can see their request was handled thoroughly, not just a one-line result.
- Give the actual answer(s) to their question, pulled from the real tool results below — do not invent or guess at any information that isn't in the record.
- If any part of the request could not be completed or the information was incomplete, say so plainly.
- Write this as a finished, standalone response — not a status update, not a plan, just the full answer as if this were the only reply the person will see.

==================================================
ORIGINAL REQUEST
==================================================

${userPrompt}

==================================================
FULL SESSION RECORD
==================================================
${transcript}

==================================================

Now write the complete summary and answer described above.`;

  console.log(
    `[AGENT][SUMMARY] Requesting post-loop synthesis` +
    ` — ~${Math.ceil(synthesisPrompt.length / 3.5)} est. tokens (${synthesisPrompt.length} chars)`
  );

  const summarySupportsThinking = await modelSupportsThinking(model);

  const payload: any = {
    model,
    prompt: synthesisPrompt,
    stream: true,
    ...(summarySupportsThinking ? { think: true } : {}),
    // No tool-calling scaffolding at all: no FenceWatcher, no fence
    // detection, no router hand-off. Tokens are streamed straight through
    // as summary_chunk events and concatenated — there is nothing here that
    // could dispatch a tool even if the model tried to emit a fence.
    options: { num_predict: -1 },
  };

  const controller = new AbortController();
  const SUMMARY_TIMEOUT_MS = 120_000;
  const timeoutId = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OLLAMA_GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = isAbort
      ? "Summary generation timed out."
      : `Failed to reach model backend for summary: ${String(err)}`;
    console.error(`[AGENT][SUMMARY] Ollama fetch failed:`, msg);
    // Swallowed by design (see function doc comment) — this must never
    // surface as a failure of the underlying agent loop run, which has
    // already completed successfully by the time this runs.
    await emit({ error: msg });
    return "";
  }
  clearTimeout(timeoutId);

  // Defensive fallback — see identical comment in runOneRound() above.
  // Kept here too since the summary call is a fully independent request
  // (different payload object, can't share the retry from the main round).
  if (!response.ok && response.status === 400 && payload.think) {
    const errText = await response.text().catch(() => "");
    if (errText.toLowerCase().includes("does not support thinking")) {
      console.warn(
        `[AGENT][SUMMARY] '${model}' rejected think:true despite capability check ` +
        `(cache was stale?) -- retrying without it and updating the cache.`
      );
      thinkingSupportCache.set(model, false);
      delete payload.think;

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), SUMMARY_TIMEOUT_MS);
      try {
        response = await fetch(OLLAMA_GENERATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: retryController.signal,
        });
      } catch (err) {
        clearTimeout(retryTimeoutId);
        const isAbort = err instanceof Error && err.name === "AbortError";
        const msg = isAbort
          ? "Summary generation timed out on retry."
          : `Failed to reach model backend for summary on retry: ${String(err)}`;
        console.error(`[AGENT][SUMMARY] Ollama retry fetch failed:`, msg);
        await emit({ error: msg });
        return "";
      }
      clearTimeout(retryTimeoutId);
    }
  }

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "");
    console.error(`[AGENT][SUMMARY] Ollama returned ${response.status}:`, errText);
    await emit({ error: `Model backend returned ${response.status} during summary: ${errText}` });
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let summaryText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // malformed line from a mid-stream chunk split — skip
        }

        // Only stream `response` tokens (the model's visible output), same
        // as the main loop does — `thinking` tokens are intentionally not
        // forwarded to the caller here, this is meant to be the polished
        // recap, not the model's scratch reasoning.
        const token: string | undefined = parsed?.response;
        if (token) {
          summaryText += token;
          await emit({ summary_chunk: token });
        }
      }
    }
  } catch (err) {
    console.error(`[AGENT][SUMMARY] Stream read failed:`, err);
    await emit({ error: `Summary stream failed: ${err instanceof Error ? err.message : String(err)}` });
    // Return whatever was gathered before the failure rather than
    // discarding it — a partial summary is still useful.
  }

  console.log(`[AGENT][SUMMARY] Synthesis complete — ${summaryText.length} chars`);
  await emit({ summary_done: { summary: summaryText } });
  return summaryText;
}

// ── The loop itself ────────────────────────────────────────────────────────

export interface AgentLoopParams {
  model: string;
  userPrompt: string;
  baseContext: string;
  // IANA zone name from the client (see lib/temporalContext.ts) — threaded
  // through so every round's system prompt reflects the device's actual
  // current date/time, not the server's.
  timezone?: string | null;
}

export async function runAgentLoop(
  params: AgentLoopParams,
  emit: AgentEventSink
): Promise<{ finalAnswer: string; rounds: number; transcript: string }> {

  const { model, userPrompt, baseContext, timezone } = params;

  const toolCatalog = toolsForRouterPrompt();
  const systemPrompt = buildAgentSystemPrompt(toolCatalog, baseContext, timezone);

  // Rolling transcript — main model reads this each round.
  // Section headers use "ASSISTANT_ACTION" (not "TOOL CALL") deliberately:
  // using "TOOL CALL" caused the model to echo that phrase in prose and bypass
  // the fence, creating a feedback loop.
  let transcript = `${systemPrompt}

==================================================
USER QUESTION
==================================================

${userPrompt}
`;

  // agentActionHistory is a plain-text rolling summary of every INSTRUCTION
  // issued so far (not just tool names) — passed to resolveAgentToolCall()
  // as extra grounding for the router's Stage 3 LFM. Deliberately NOT used
  // to block repeat tool names across rounds: a multi-part request like
  // "search X, then search Y and Z individually" legitimately calls
  // internet_search multiple times with different arguments each round.
  // De-dup only matters WITHIN one instruction's resolution (defensive,
  // in case Stage 2+3 both resolve the same tool for one sentence) — that's
  // what the fresh Set passed to resolveAgentToolCall on each round is for.
  let agentActionHistory = "";

  // ── Exact-repeat tool-call cache ────────────────────────────────────────
  // agentActionHistory (above) deliberately does NOT block repeat tool
  // *names* across rounds, because legitimate multi-part plans call the
  // same tool many times with different arguments. But nothing previously
  // stopped the router from resolving the EXACT same tool+arguments pair
  // twice — which happens in practice when the main model rephrases its
  // instruction slightly ("Search for X" vs "Search for X and retrieve
  // names") but the Stage 3 LFM extracts identical arguments both times.
  // Observed in production: internet_search called across several rounds
  // with the byte-identical query, returning byte-identical results each
  // time, with the model unable to extract what it needed and simply
  // re-asking — an unbounded loop since nothing detected "this exact call
  // already happened and will not produce new information."
  //
  // This cache maps a stable signature (tool name + sorted-key-JSON of
  // arguments) → the result text that call produced. On an exact repeat we
  // skip re-execution entirely (saves the network/tool round-trip too) and
  // splice in a SYSTEM NOTE that forces the model to either work with the
  // existing result or make a materially different request, rather than
  // silently feeding it the same transcript shape and letting it loop
  // again. Deliberately keyed on exact argument equality, not fuzzy
  // matching — a genuinely different query (different actor name, etc.)
  // must always be allowed through.
  const executedCalls = new Map<string, string>();

  function callSignature(tool: string, args: Record<string, string>): string {
    const sortedArgs = Object.keys(args)
      .sort()
      .reduce((acc, k) => { acc[k] = args[k]; return acc; }, {} as Record<string, string>);
    return `${tool}::${JSON.stringify(sortedArgs)}`;
  }

  // ── Phase Execution Tracker ────────────────────────────────────────
  // Lightweight sidecar that uses lfm2.5-thinking:1.2b to classify the main
  // model's first response into execution phases, track completion via
  // tool-success/failure EVENTS (not round count), maintain an execution
  // confidence score, and inject a compact PLAN TRACKER block into the
  // transcript before each round.  Non-blocking: any failure is silently
  // logged and the main loop continues normally.
  const phaseTracker = new PhaseTrackerService();

  let round = 1;
  let finalAnswer = "";
  // Plan-completeness gate: how many times we've rejected a "final answer"
  // because phaseTracker still shows incomplete phases. Bounded so a
  // tracker misclassification (it's a lfm2.5-thinking:1.2b heuristic, not
  // ground truth — see phaseTracker.ts) can never hard-loop a session; once
  // the cap is hit, the model's final answer is accepted regardless.
  let rejectedFinalAnswers = 0;
  const MAX_FINAL_ANSWER_REJECTIONS = 2;

  // ── Hard round cap (backstop) ────────────────────────────────────────────
  // By design this loop has no *soft* cap — the model decides when it's
  // done, and legitimate multi-part requests (e.g. "research these 5 actors
  // individually") can genuinely need a dozen-plus rounds. But "no soft cap"
  // must never mean "no cap at all": a stuck loop (model can't extract what
  // it needs from a tool result, phase tracker never clears, etc.) was
  // observed running 10+ rounds with no termination in sight, burning
  // GPU/VRAM and wall-clock time indefinitely. This is deliberately set
  // generous — high enough that it never fires on a real, progressing
  // multi-step task — so it only ever catches genuine runaway loops rather
  // than cutting off legitimate long plans early.
  const MAX_ROUNDS = 25;
  const loopStart = Date.now();

  console.log("\n========== AGENT LOOP START ==========");
  console.log(`[AGENT] model: ${model}`);
  console.log(`[AGENT] prompt: ${userPrompt}`);
  console.log(`[AGENT] baseContext: ~${Math.ceil(baseContext.length / 3.5)} est. tokens (${baseContext.length} chars)`);
  console.log("======================================\n");

  while (true) {
    const roundStart = Date.now();
    console.log(`\n[AGENT][ROUND ${round}] ─────────────────── START ───────────────────`);

    await emit({ round });

    if (round > MAX_ROUNDS) {
      // Backstop tripped: the model has taken MAX_ROUNDS actions without
      // reaching a final answer. Rather than throwing or silently cutting
      // the stream, ask the SAME model for one last best-effort summary of
      // everything gathered so far, then end the loop unconditionally —
      // no further rounds regardless of what comes back.
      console.warn(
        `[AGENT] MAX_ROUNDS (${MAX_ROUNDS}) exceeded — forcing a final answer ` +
        `from everything gathered so far and ending the loop`
      );
      await emit({ status: `Reached the ${MAX_ROUNDS}-round safety limit — wrapping up with what's been gathered so far.` });

      const wrapUpPrompt = `${transcript}

==================================================
SYSTEM NOTE (round limit reached)
==================================================

You have reached the maximum number of allowed actions for this request.
No further tool calls are possible. Give your best final answer now, in
plain text with NO \`\`\`tool_call fence, using only the information already
gathered above. If some parts of the request could not be completed,
say so plainly rather than guessing.
`;

      let wrapUpText = "";
      try {
        const wrapUpResult = await runOneRound(model, wrapUpPrompt, emit, round);
        wrapUpText = wrapUpResult.text.trim();
      } catch (err) {
        console.error(`[AGENT] Wrap-up generation after MAX_ROUNDS failed:`, err);
      }

      finalAnswer = wrapUpText || (
        "I reached my safety limit for this request after taking a large " +
        "number of actions without fully resolving it. Here's what I was " +
        "able to gather before stopping — you may want to ask a narrower " +
        "follow-up question for anything still missing."
      );

      await emit({ response: finalAnswer });
      console.log(`[AGENT] ─────────────────── END (round cap) ───────────────────\n`);
      break;
    }

    const transcriptChars = transcript.length;
    console.log(`[AGENT][ROUND ${round}] transcript size: ~${Math.ceil(transcriptChars / 3.5)} est. tokens (${transcriptChars} chars)`);

    const prompt = `${transcript}

Respond now. If you need to take an action, emit exactly one \`\`\`tool_call
fence containing ONE plain-English instruction and STOP. If you have enough
information, give your final answer.
`;

    const { text, instruction, extraInstructions, usedFallback } = await runOneRound(model, prompt, emit, round);

    const roundElapsed = Date.now() - roundStart;

    // ── Phase tracker: store this round's narration ────────────────────────
    // Always store the visible text (even for final-answer rounds) so the
    // history is complete.  processRound1 is called here too so that the
    // tracker is initialized BEFORE any tool is dispatched this round.
    phaseTracker.addLLMOutput(round, text);
    if (round === 1) {
      // Fire-and-forget: await but non-blocking error handling is inside.
      await phaseTracker.processRound1(text, userPrompt);
    }

    if (!instruction) {
      // ── Plan-completeness gate ──────────────────────────────────────────
      // The model gave no instruction (i.e. it believes it's done), but the
      // phase tracker may still show unresolved phases. Left unchecked, the
      // loop would accept this as final unconditionally — exactly what let
      // a model stop early on a multi-part request without ever attempting
      // the remaining steps.
      //
      // This is deliberately NOT a hard gate: phaseTracker is a heuristic
      // classification from a 1.2b sidecar model, not ground truth (see
      // phaseTracker.ts's own non-blocking-by-design comment), so treating
      // its phase list as unconditionally binding would let a tracker
      // misclassification hard-loop a session against a model that's
      // actually correct. Three things keep this safe:
      //   1. The model can override the tracker — the rejection prompt
      //      explicitly allows "explain why these are no longer needed and
      //      still answer", not just "obey and act".
      //   2. Bounded to MAX_FINAL_ANSWER_REJECTIONS retries — after that,
      //      the model's answer is accepted regardless of tracker state.
      //   3. Skipped entirely when usedFallback is true — an instruction
      //      recovered via a fallback path already signals the model's
      //      output was ambiguous; piling a second challenge on top of an
      //      already-uncertain round adds risk without adding signal.
      const incomplete = phaseTracker.getIncompletePhases();
      if (
        incomplete.length > 0 &&
        !usedFallback &&
        rejectedFinalAnswers < MAX_FINAL_ANSWER_REJECTIONS
      ) {
        rejectedFinalAnswers += 1;
        console.warn(
          `[AGENT][ROUND ${round}] Model gave a final answer but ${incomplete.length} ` +
          `phase(s) still incomplete — rejecting (${rejectedFinalAnswers}/${MAX_FINAL_ANSWER_REJECTIONS}): ` +
          incomplete.map((p) => p.description).join("; ")
        );
        transcript += `
==================================================
SYSTEM NOTE (round ${round} — final answer rejected)
==================================================

You did not emit a \`\`\`tool_call fence, but the following planned steps
still show as incomplete:
${incomplete.map((p, i) => `${i + 1}. ${p.description}`).join("\n")}

This response was NOT shown to the user. Now either:
(a) issue the next \`\`\`tool_call instruction for one of the steps above, or
(b) if those steps are genuinely no longer needed, say so explicitly and
    why, then give your final answer again.
`;
        round += 1;
        continue;
      }

      finalAnswer = text;

      if (!finalAnswer.trim()) {
        // Genuinely empty output — most commonly an unterminated fence that
        // consumed the entire generation (see FenceWatcher.finish()). Don't
        // let this silently become an empty stored/streamed message.
        //
        // IMPORTANT: `finalAnswer` being non-empty here is NOT enough on its
        // own — it only affects boot.ts's server-side console logging. The
        // actual client-visible (and DB-persisted) message is built from
        // {response} events emitted over the stream. If we only emit
        // {status}, a frontend that reconstructs the saved message from
        // {response} events sees nothing and saves an empty string — which
        // is exactly what was happening even after finalAnswer was fixed.
        console.warn(
          `[AGENT][ROUND ${round}] Final answer was empty after ${roundElapsed}ms —` +
          ` surfacing a status instead of an empty message`
        );
        finalAnswer =
          "I started working on this but didn't produce a complete answer that round. " +
          "Please try again — if this keeps happening, it may be worth simplifying the request.";
        await emit({ status: "Model produced no output this round — see logs." });
        await emit({ response: finalAnswer });
      }

      console.log(
        `[AGENT][ROUND ${round}] No action signal — final answer` +
        ` (${finalAnswer.length} chars) | round took ${roundElapsed}ms`
      );
      console.log(`[AGENT][ROUND ${round}] ─────────────────── END (final) ───────────────────\n`);
      break;
    }

    if (usedFallback) {
      console.log(`[AGENT][ROUND ${round}] ⚠  Instruction via prose fallback (model skipped fence format)`);
    }

    console.log(`[AGENT][ROUND ${round}] Instruction: "${instruction}" → handing to 3-stage router`);
    console.log(`[ROUTER][AGENT] ========== ROUTING ROUND ${round} ==========`);

    // ── Route through the 3-stage tool router ─────────────────────────────
    // resolveAgentToolCall treats `instruction` exactly like a fresh user
    // message and runs Stage 2 (regex) + Stage 3 (LFM native function-
    // calling, lfm2.5-thinking:1.2b) on IT — not on the original userPrompt
    // — so argument extraction is accurate per-step instead of stale/reused.
    // The main model never generates tool names or JSON at all.
    let routerTools: ToolCall[];
    try {
      routerTools = await resolveAgentToolCall(
        instruction,
        agentActionHistory,
        new Set<string>()   // intra-instruction dedup only, see note above
      );
    } catch (err) {
      console.error(`[AGENT][ROUND ${round}] resolveAgentToolCall threw:`, err);
      routerTools = [];
    }

    console.log(`[ROUTER][AGENT] ========== END ROUTING ROUND ${round} ==========`);

    if (routerTools.length === 0) {
      // Router couldn't resolve a tool for this instruction. Tell the main
      // model so it can rephrase more specifically or move on, rather than
      // silently looping on the same failure.
      console.warn(
        `[AGENT][ROUND ${round}] Router returned 0 tools for instruction="${instruction}"` +
        ` — asking model to rephrase or give a final answer`
      );
      transcript += `
==================================================
SYSTEM NOTE (round ${round})
==================================================

Your last instruction ("${instruction}") could not be resolved to a real
action — it may have been too vague or referenced something not covered by
any available tool. Either rephrase it more specifically and try again, or
give your best final answer based on information gathered so far.
`;
      round += 1;
      continue;
    }

    // ── Execute all router-resolved tools ────────────────────────────────
    // Normally one tool per instruction, but the router can occasionally
    // resolve more than one (e.g. an ambiguous match); execute all of them.
    const toolResultTexts: string[] = [];
    const repeatedCallsThisRound: string[] = [];

    for (const toolCall of routerTools) {

      const signature = callSignature(toolCall.tool, toolCall.arguments);
      const cachedResult = executedCalls.get(signature);
      if (cachedResult !== undefined) {
        repeatedCallsThisRound.push(`${toolCall.tool}(${JSON.stringify(toolCall.arguments)})`);
      }

      console.log(
        `[AGENT][ROUND ${round}] Dispatching '${toolCall.tool}'` +
        ` | args: ${JSON.stringify(toolCall.arguments)}` +
        (cachedResult ? ` | EXACT REPEAT — skipping execution, reusing prior result` : "")
      );

      await emit({ tool_call: { tool: toolCall.tool, arguments: toolCall.arguments } });

      let execResult: ExecutionResult;
      let toolElapsed: number;

      if (cachedResult !== undefined) {
        // Exact same tool + arguments already ran this session. Re-running
        // it would burn a tool round-trip for a byte-identical result and,
        // more importantly, wouldn't give the model anything new — the
        // repeated-instruction loop this guards against is precisely a
        // model re-asking the same unanswerable question. Short-circuit
        // with the cached result and let the SYSTEM NOTE below (added
        // after this loop via the repeat flag) push the model toward a
        // different action instead of the same dead end.
        console.warn(
          `[AGENT][ROUND ${round}] Skipping duplicate call to '${toolCall.tool}' ` +
          `with identical arguments — reusing cached result from earlier this session`
        );
        const toolStart = Date.now();
        execResult = { success: true, result: cachedResult };
        toolElapsed = Date.now() - toolStart;
      } else {
        const toolStart = Date.now();
        try {
          execResult = await executeTool(toolCall);
        } catch (err) {
          execResult = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        toolElapsed = Date.now() - toolStart;

        if (execResult.success) {
          executedCalls.set(signature, JSON.stringify(execResult.result));
        }
      }

      if (execResult.success) {
        const resultStr    = JSON.stringify(execResult.result);
        const resultPreview = resultStr.slice(0, 200);
        console.log(
          `[AGENT][ROUND ${round}] Tool '${toolCall.tool}' SUCCESS in ${toolElapsed}ms` +
          ` | size=${resultStr.length} chars | preview: ${resultPreview}${resultStr.length > 200 ? "..." : ""}`
        );
      } else {
        console.error(
          `[AGENT][ROUND ${round}] Tool '${toolCall.tool}' FAILED in ${toolElapsed}ms` +
          ` | error: ${execResult.error}`
        );
      }

      await emit({
        tool_result: {
          tool:    toolCall.tool,
          success: execResult.success,
          result:  execResult.success ? execResult.result : undefined,
          error:   execResult.success ? undefined : execResult.error,
        },
      });

      // ── Phase tracker: fire completion event ──────────────────────────
      // This is the event-driven completion trigger.  The tracker calls the
      // UPDATE prompt on lfm2.5-thinking:1.2b, marks the matching phase done
      // (or failed), optionally expands placeholder phases with specific names
      // from the result, updates confidence, and detects replanning.
      if (execResult.success) {
        const trackerResultPreview = JSON.stringify(execResult.result ?? "").slice(0, 400);
        await phaseTracker.onToolSuccess(toolCall.tool, toolCall.arguments as Record<string, unknown>, trackerResultPreview);
      } else {
        await phaseTracker.onToolFailure(toolCall.tool, toolCall.arguments as Record<string, unknown>, execResult.error ?? "unknown error");
      }

      const resultText = execResult.success
        ? JSON.stringify(execResult.result, null, 2)
        : `ERROR: ${execResult.error}`;

      toolResultTexts.push(
        `Instruction: ${instruction}\nResolved to: ${toolCall.tool}(${JSON.stringify(toolCall.arguments)})\n\nResult:\n${resultText}`
      );

      // Update the rolling history for the router.
      // IMPORTANT: include a result preview (600 chars) so the Stage 3 LFM
      // has actual content to reason about when constructing the NEXT
      // instruction's arguments. Without this, a round-2 instruction like
      // "search for each cast member" leaves the LFM with no idea who the
      // cast members are — it can only see the instruction sentence, not the
      // previous result. The preview gives it the raw material to extract
      // specific names, values, or items for subsequent targeted searches.
      const HISTORY_RESULT_PREVIEW_CHARS = 600;
      const historyResultStr = execResult.success
        ? JSON.stringify(execResult.result)
        : `ERROR: ${execResult.error}`;
      const historyResultPreview = historyResultStr.slice(0, HISTORY_RESULT_PREVIEW_CHARS);
      const historyResultTruncated = historyResultStr.length > HISTORY_RESULT_PREVIEW_CHARS;
      agentActionHistory +=
        `\nRound ${round}: instruction="${instruction}" → ${toolCall.tool}(${JSON.stringify(toolCall.arguments)})` +
        ` → ${execResult.success ? "success" : "failed"}` +
        `\n  Result: ${historyResultPreview}${historyResultTruncated ? "..." : ""}`;
    }

    // Fold this round's instruction + result into the transcript for the
    // next round. Label: ASSISTANT_ACTION (not TOOL CALL) — avoids the model
    // echoing the label back as prose.
    transcript += `
==================================================
ASSISTANT_ACTION (round ${round})
==================================================

${toolResultTexts.join("\n\n---\n\n")}
`;

    if (repeatedCallsThisRound.length > 0) {
      // At least one resolved tool call this round was byte-identical
      // (same tool, same arguments) to one already executed earlier in
      // this session. Re-running it was skipped and the cached result was
      // reused above — but silently doing that isn't enough on its own:
      // without an explicit nudge, the model tends to just repeat the same
      // (slightly rephrased) instruction again next round, since from its
      // point of view it "asked for something and got a result" each time.
      // Naming the repeat explicitly and instructing it to change course
      // is what actually breaks the cycle observed in production, where
      // internet_search was called with an identical query across four
      // separate rounds because the result never contained a usable
      // extractable answer.
      transcript += `
==================================================
SYSTEM NOTE (round ${round} — repeated call detected)
==================================================

The following action this round was IDENTICAL (same tool, same arguments)
to one already executed earlier in this session, so it was not re-run —
the result shown above is reused from before, not new data:
${repeatedCallsThisRound.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Running the exact same query again will not produce different information.
Do NOT repeat this instruction. Instead:
(a) if the existing result actually contains what you need, extract it and
    move on to the next step or give your final answer, or
(b) if it genuinely doesn't contain what you need, try a MATERIALLY
    different instruction — a different search angle, a different specific
    name or term, or a different source — not a rephrasing of the same
    request, or
(c) if neither (a) nor (b) is possible, say so plainly in your final
    answer rather than continuing to retry.
`;
    }

    if (extraInstructions.length > 0) {
      // The model wrote more than one tool_call fence in a single generation,
      // which breaks the "one atomic instruction, then stop" contract. Only
      // the first fence was executed above — make that explicit so the model
      // doesn't wrongly assume the rest already happened, and tell it to
      // re-issue each one on its own in a future round.
      transcript += `
==================================================
SYSTEM NOTE (round ${round})
==================================================

You wrote ${extraInstructions.length} additional \`\`\`tool_call fence(s) in that
same generation, which is not allowed — only ONE instruction per round. Only
the first one was acted on. These were NOT executed and nothing has happened
for them yet:
${extraInstructions.map((instr, i) => `${i + 1}. "${instr}"`).join("\n")}

If any of these are still needed, issue them ONE AT A TIME in the rounds
that follow — do not assume they already ran.
`;
    }

    // ── Phase tracker: inject PLAN TRACKER block ────────────────────────
    // Injected AFTER the ASSISTANT_ACTION block and AFTER any SYSTEM NOTE
    // about extra fences, so the model sees all tool results first, then
    // the tracker summary.  The block is compact: phase status + LLM
    // narration history (NOT the raw tool results which are already above).
    const trackerBlock = phaseTracker.buildContextBlock(round + 1);  // +1 = upcoming round number
    if (trackerBlock) {
      transcript += `
==================================================
SYSTEM NOTE (plan tracker — round ${round + 1})
==================================================

${trackerBlock}
`;
    }

    console.log(
      `[AGENT][ROUND ${round}] ─────────────────── END` +
      ` (tools_executed=${routerTools.length}) | round took ${roundElapsed}ms ───────────────────\n`
    );

    round += 1;
  }

  const totalElapsed = Date.now() - loopStart;
  console.log("\n========== AGENT LOOP END ==========");
  console.log(`[AGENT] Rounds: ${round} | Total elapsed: ${totalElapsed}ms | Answer length: ${finalAnswer.length} chars`);
  console.log("=====================================\n");

  return { finalAnswer, rounds: round, transcript };
}