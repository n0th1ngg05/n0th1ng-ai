import {
  searchKnowledge,
} from "./semanticSearch";

export async function buildRagPrompt(
  userPrompt: string,
  selectedFiles?: number[],
  conversationMemory?: string
) {

  const searchResult =
    await searchKnowledge(
      userPrompt,
      3,
      selectedFiles
    );

  const MAX_CONTEXT_CHARS = 8000;

const chunks = [];
let currentSize = 0;

for (const chunk of searchResult.chunks) {

  if (
    currentSize +
      chunk.content.length >
    MAX_CONTEXT_CHARS
  ) {
    break;
  }

  chunks.push(chunk);
  currentSize += chunk.content.length;

}

console.log(
  "[RAG CONTEXT]",
  {
    chunks: chunks.length,
    characters: currentSize,
  }
);

  console.log(
    "[RAG FILES]",
    selectedFiles
  );

  let context = "No relevant documents found in knowledge base.";

  if (chunks.length === 0) {
    console.log(
      "[RAG] No relevant chunks found"
    );
  } else {
    console.log(
      "[RAG]",
      {
        bestScore:
          searchResult.bestScore,

        chunks:
          chunks.length,
      }
    );

    const grouped =
  new Map<
    string,
    typeof chunks
  >();

for (
  const chunk
  of chunks
) {

  if (
    !grouped.has(
      chunk.fileName
    )
  ) {

    grouped.set(
      chunk.fileName,
      []
    );

  }

  grouped
    .get(
      chunk.fileName
    )!
    .push(chunk);

}

context =
  [...grouped.entries()]
    .map(
      (
        [
          fileName,
          fileChunks,
        ]
      ) =>
`
==================================================
FILE

${fileName}

==================================================

${fileChunks
  .map(
    chunk =>
`• ${chunk.content}`
  )
  .join("\n\n")}
`
    )
    .join("\n\n");
  }

  const prompt = `
You are n0th1ng AI, an advanced AI assistant operating inside a local AI workstation.

Your goals:
- Be accurate and helpful.
- Use conversation history to maintain context.
- Use the knowledge base when relevant.
- Combine retrieved knowledge with your own reasoning when appropriate.
- If retrieved knowledge conflicts with general knowledge, prioritize the retrieved knowledge for project-specific information.
- Do not mention internal implementation details unless explicitly asked.
- Maintain continuity with the user's previous messages.

==================================================
RECENT CONVERSATION
==================================================

${conversationMemory ?? "No previous conversation available."}

==================================================
KNOWLEDGE BASE CONTEXT
==================================================

${context}

==================================================
CURRENT USER QUESTION
==================================================

${userPrompt}

==================================================
RESPONSE INSTRUCTIONS
==================================================

If a TOOL RESULT section is present:

- Treat it as factual data.
- Use it when answering.
- Do not ignore it.
- Explain it naturally to the user.
- Do not mention internal tool names unless relevant.

1. First determine whether the question depends on:
   - Previous conversation
   - Knowledge base context
   - General model knowledge
   - A combination of the above

2. If conversation history contains relevant information:
   - Use it to understand references such as:
     "that", "it", "this", "the project", "the file", etc.

3. If the knowledge base contains useful information:
   - Use it naturally.
   - Do not quote large chunks verbatim unless requested.

4. If neither conversation nor knowledge base is relevant:
   - Answer normally using your own knowledge.

5. Never claim information exists in the knowledge base if it does not.

6. If uncertain:
   - State uncertainty rather than inventing facts.

Provide the best possible answer to the user's question.
`;

  return {
    prompt,

    sources:
      chunks.map(
        chunk => ({
          fileId:
            chunk.fileId,

          fileName:
            chunk.fileName,

          chunkId:
            chunk.chunkId,
        })
      ),
  };

}