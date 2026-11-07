// api/lib/apcPrompt.ts
//
// Tier 2 Point 2: Automatic Prefix Caching (APC) Prompt Builder.
// In engines supporting KV prefix caching (vLLM, SGLang, Ollama / llama.cpp prompt-cache),
// cache hits are computed from Token 0 sequentially.
// If dynamic values (like the current second/minute timestamp) appear at line 1,
// 100% of KV cache is invalidated on every request.
//
// This builder guarantees:
//   1. Static System Instructions & Guidelines stay at Token 0..K (100% constant across all turns).
//   2. Conversation History appears at Tokens K..M (reused from prior turns in the same conversation).
//   3. Dynamic Context (Date/Time, Memory, Uploads, Tool Outputs, User Request) appears at the tail (Tokens M..N).

export interface ApcPromptParams {
  systemInstructions?: string;
  conversationContext?: string;
  temporalContext?: string;
  memoryContext?: string;
  attachmentContext?: string;
  toolContext?: string;
  ragContext?: string;
  userPrompt: string;
}

export function buildApcPrompt(params: ApcPromptParams): string {
  const STATIC_SYSTEM_PROMPT =
    params.systemInstructions?.trim() ||
    `You are an intelligent, helpful, and versatile AI assistant. Answer questions accurately, clearly, and naturally. If code or technical instructions are requested, provide properly formatted markdown code blocks.`;

  const sections: string[] = [];

  // 1. Static Prefix (Tokens 0..K) — Always identical across requests
  sections.push(STATIC_SYSTEM_PROMPT);

  // 2. Conversation History (Tokens K..M) — Stable prefix from previous turns
  if (params.conversationContext && params.conversationContext.trim()) {
    sections.push(
      `==================================================\nCONVERSATION HISTORY\n==================================================\n${params.conversationContext.trim()}`
    );
  }

  // 3. Dynamic Environment Context (Tokens M..N)
  const dynamicParts: string[] = [];

  if (params.temporalContext && params.temporalContext.trim()) {
    dynamicParts.push(params.temporalContext.trim());
  }

  if (params.memoryContext && params.memoryContext.trim()) {
    dynamicParts.push(`Stored Memory:\n${params.memoryContext.trim()}`);
  }

  if (params.attachmentContext && params.attachmentContext.trim()) {
    dynamicParts.push(params.attachmentContext.trim());
  }

  if (params.ragContext && params.ragContext.trim()) {
    dynamicParts.push(`Reference Material:\n${params.ragContext.trim()}`);
  }

  if (params.toolContext && params.toolContext.trim()) {
    dynamicParts.push(params.toolContext.trim());
  }

  if (dynamicParts.length > 0) {
    sections.push(
      `==================================================\nENVIRONMENT & DYNAMIC CONTEXT\n==================================================\n${dynamicParts.join("\n\n")}`
    );
  }

  // 4. User Request & Answering Directive
  sections.push(
    `==================================================\nUSER REQUEST\n==================================================\n${params.userPrompt.trim()}\n\nAnswer the user request naturally and directly using the context and any tool results provided above.`
  );

  return sections.join("\n\n");
}
