import { memorySearch } from "./memory";

export async function buildMemoryContext(
  prompt: string
) {
  const memories =
    await memorySearch(
      prompt
    );

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