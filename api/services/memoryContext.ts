import { memorySearch } from "./memory";

export async function buildMemoryContext(
  prompt: string
) {
  let memories: any[] = [];
  try {
    memories = await memorySearch(prompt);
  } catch (err) {
    // Embedding backend unreachable: answer without memory instead of failing the chat.
    console.warn("[MEMORY] Memory search unavailable, continuing without it:", err instanceof Error ? err.message : err);
  }

  if (
    memories.length === 0
  ) {
    return "";
  }

  const formatted =
    memories
      .slice(0, 5)
      .map(
        (memory: any) =>
          `• [${memory.category}] ${memory.key} = ${memory.value}`
      )
      .join("\n");

  return `

========================
RELEVANT MEMORIES
========================

${formatted}

========================

`;
}