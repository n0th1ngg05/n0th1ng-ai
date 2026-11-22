import { OLLAMA_EMBED_URL, OLLAMA_EMBED_MODEL } from "../lib/cloud";

export async function generateEmbedding(text: string) {
  const response = await fetch(`${OLLAMA_EMBED_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  });

  if (!response.ok) {
    throw new Error("Embedding generation failed");
  }

  const data = await response.json();

  return data.embedding;
}
