/**
 * contextWindow.ts
 *
 * Centralizes "how much conversation history do we hand the model" logic.
 *
 * Replaces the old fixed "last 12 messages" / "summarize at 20 messages"
 * behavior in boot.ts with a token-budgeted sliding window:
 *
 *   - Keep as many of the most recent messages as fit in ~150k tokens,
 *     capped at 50 messages, whichever limit is hit first.
 *   - As soon as older messages would fall OUTSIDE that window (i.e. the
 *     conversation has grown past the cap), roll them into the stored
 *     summary so nothing is silently dropped.
 *   - The final prompt block always looks like:
 *       [SUMMARY of everything older than the window]
 *       [full verbatim messages inside the window]
 *
 * NOTE on token counting: Ollama's local models don't expose a tokenizer
 * over HTTP, and different local models (llama/qwen/gemma/etc.) all
 * tokenize slightly differently anyway. Rather than pull in a tokenizer
 * tuned for a *different* model family and give a false sense of
 * precision, this uses a conservative chars-per-token estimate. It's
 * intentionally a slight overestimate (fewer chars per token than most
 * real tokenizers) so we stay safely under real budgets rather than
 * risk overflowing a model's actual context window.
 */

import {
  getConversationMessages,
} from "./conversationMemory";
import {
  getVoiceConversationMessages,
} from "./voiceConversationMemory";

export type ConversationMessageLike = {
  role: string;
  content: string | null;
  createdAt?: Date | string | null;
};

// ---- Tunables -------------------------------------------------------

/** Hard cap on how many tokens of raw message history we'll keep verbatim. */
export const MAX_CONTEXT_TOKENS = 150_000;

/** Hard cap on how many messages we'll keep verbatim, regardless of tokens. */
export const MAX_CONTEXT_MESSAGES = 50;

/** Conservative chars-per-token estimate (see note above). */
const CHARS_PER_TOKEN = 3.5;

// ---- Token estimation -------------------------------------------------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function formatMessage(m: ConversationMessageLike): string {
  return `${m.role.toUpperCase()}:\n\n${m.content ?? ""}`;
}

// ---- Windowing ----------------------------------------------------------

export type ContextWindow = {
  /** Messages that fit inside the token/message budget, oldest-first. */
  windowMessages: ConversationMessageLike[];
  /** Messages older than the window — these are what the summary must cover. */
  overflowMessages: ConversationMessageLike[];
  /** Estimated token count of windowMessages. */
  windowTokens: number;
  /** True once the conversation has grown past either cap. */
  isOverflowing: boolean;
};

/**
 * Walks the message list backward (newest first), accumulating messages
 * into the "keep verbatim" window until either MAX_CONTEXT_TOKENS or
 * MAX_CONTEXT_MESSAGES would be exceeded. Everything older than that
 * point is overflow and needs to be represented by the summary instead.
 */
export function computeContextWindow(
  messages: ConversationMessageLike[]
): ContextWindow {
  const windowMessages: ConversationMessageLike[] = [];
  let windowTokens = 0;
  let cutoffIndex = messages.length; // index (exclusive) where overflow begins

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(formatMessage(msg));

    const wouldExceedTokens = windowTokens + msgTokens > MAX_CONTEXT_TOKENS;
    const wouldExceedCount = windowMessages.length + 1 > MAX_CONTEXT_MESSAGES;

    if (wouldExceedTokens || wouldExceedCount) {
      cutoffIndex = i + 1;
      break;
    }

    windowMessages.unshift(msg);
    windowTokens += msgTokens;
    cutoffIndex = i;
  }

  const overflowMessages = messages.slice(0, cutoffIndex);

  return {
    windowMessages,
    overflowMessages,
    windowTokens,
    isOverflowing: overflowMessages.length > 0,
  };
}

// ---- Assembly -------------------------------------------------------

export type BuiltConversationContext = {
  /** Fully assembled text block ready to drop into the prompt. */
  context: string;
  /** Whether a fresh summary needs to be generated this turn. */
  needsSummary: boolean;
  /** Messages that must be summarized (only set when needsSummary is true).
   *  content is normalized to non-null here — see buildConversationContext. */
  messagesToSummarize: { role: string; content: string }[];
  /** All messages for this conversation, oldest-first (handy for logging). */
  allMessages: ConversationMessageLike[];
  windowTokens: number;
  windowMessageCount: number;
};

/**
 * Single entry point used by boot.ts. Fetches the conversation's messages,
 * computes the token/message window, and decides whether a new summary
 * needs to be generated this turn (i.e. the conversation just grew past
 * the window for the first time, or has grown further since the last
 * summary was stored).
 *
 * `existingSummary` should be whatever is currently stored (possibly "").
 * `existingSummary` is treated as covering everything OLDER than the
 * previous overflow cutoff; if the overflow set has grown since then,
 * `needsSummary` comes back true so the caller can regenerate it.
 */
export async function buildConversationContext(params: {
  conversationId: number | string;
  isVoice: boolean;
  existingSummary: string;
  /** How many overflow messages the existing summary was generated from. */
  summarizedMessageCount: number;
}): Promise<BuiltConversationContext> {
  const {
    conversationId,
    isVoice,
    existingSummary,
    summarizedMessageCount,
  } = params;

  const allMessages: ConversationMessageLike[] = isVoice
    ? await getVoiceConversationMessages(conversationId as string)
    : await getConversationMessages(Number(conversationId));

  const { windowMessages, overflowMessages, windowTokens } =
    computeContextWindow(allMessages);

  // We need a (re)generated summary when there ARE overflow messages and
  // either: no summary exists yet, or more messages have overflowed since
  // the last summary was generated (conversation kept growing).
  const needsSummary =
    overflowMessages.length > 0 &&
    (!existingSummary || overflowMessages.length > summarizedMessageCount);

  const recentBlock = windowMessages.map(formatMessage).join("\n\n");

  let context: string;

  if (overflowMessages.length > 0 && existingSummary) {
    context = `
========================
CONVERSATION SUMMARY (older messages)
========================

${existingSummary}

========================
RECENT MESSAGES (last ${windowMessages.length}, ~${windowTokens} tokens)
========================

${recentBlock}
`;
  } else {
    context = recentBlock || "No previous conversation available.";
  }

  return {
    context,
    needsSummary,
    // summarizeConversation() (conversationSummary.ts) expects
    // content: string, not string | null -- normalize here at the
    // boundary rather than changing ConversationMessageLike, which
    // correctly reflects the DB's nullable content column everywhere
    // else in this file.
    messagesToSummarize: needsSummary
      ? overflowMessages.map((m) => ({ role: m.role, content: m.content ?? "" }))
      : [],
    allMessages,
    windowTokens,
    windowMessageCount: windowMessages.length,
  };
}