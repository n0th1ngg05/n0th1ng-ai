import { getDb } from "../queries/connection";
import {
  memoryChunks,
  memoryChunkEmbeddings,
  memories,
} from "@db/schema";

import {
  generateEmbedding,
} from "./embeddingService";

function cosineSimilarity(
  a: number[],
  b: number[]
) {

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {

    dot +=
      a[i] * b[i];

    magA +=
      a[i] * a[i];

    magB +=
      b[i] * b[i];

  }

  return (
    dot /
    (
      Math.sqrt(magA) *
      Math.sqrt(magB)
    )
  );

}

export async function searchMemories(
  query: string,
  limit = 5,
  selectedFiles?: number[]
) {

  const db =
    getDb();

  const queryEmbedding =
    await generateEmbedding(
      query
    );

  let chunks =
  await db.query.memoryChunks.findMany();



  const embeddings =
    await db.query.memoryChunkEmbeddings.findMany();
  const memoryRecords =
  await db.query.memories.findMany();

  const results = [];

  for (
    const embeddingRow
    of embeddings
  ) {

    const chunk =
      chunks.find(
        c =>
          c.id ===
          embeddingRow.chunkId
      );

    if (!chunk)
      continue;

    const memory =
  memoryRecords.find(
    m =>
      m.id ===
      chunk.memoryId
  );

    const score =
      cosineSimilarity(
        queryEmbedding,
        embeddingRow.embedding as number[]
      );

    results.push({

  memoryId:
    memory?.id,

  category:
    memory?.category,

  key:
    memory?.key,

  value:
    memory?.value,

  score,

});

  }

  results.sort(
  (a, b) =>
    b.score -
    a.score
);

const filtered =
  results.filter(
    r => r.score > 0.45
  );

return {
  bestScore:
    filtered.length > 0
      ? filtered[0].score
      : 0,

  chunks:
    filtered.slice(
      0,
      limit
    ),
};

}