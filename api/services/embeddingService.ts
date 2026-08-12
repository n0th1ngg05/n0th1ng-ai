export async function generateEmbedding(
  text: string
) {

  const response =
    await fetch(
      "http://localhost:11434/api/embeddings",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            model:
              "nomic-embed-text",

            prompt:
              text,
          }),
      }
    );

  if (!response.ok) {
    throw new Error(
      "Embedding generation failed"
    );
  }

  const data =
    await response.json();

  return data.embedding;
}