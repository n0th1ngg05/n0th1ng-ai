import { getDb } from "../queries/connection";
import {
  knowledgeChunks,
  chunkEmbeddings,
  files,
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

function keywordScore(
  query: string,
  text: string
) {

  const queryWords =
    query
      .toLowerCase()
      .split(/\s+/)
      .filter(
        word =>
          word.length > 2
      );

  const textLower =
    text.toLowerCase();

  let matches = 0;

  for (
    const word
    of queryWords
  ) {

    if (
      textLower.includes(word)
    ) {

      matches++;

    }

  }

  return (
    matches /
    Math.max(
      queryWords.length,
      1
    )
  );

}

export async function searchKnowledge(
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
  await db.query.knowledgeChunks.findMany();

if (
  selectedFiles &&
  selectedFiles.length > 0
) {

  chunks =
    chunks.filter(
      chunk =>
        selectedFiles.includes(
          Number(chunk.fileId)
        )
    );

    console.log(
  "[RAG FILE FILTER]",
  {
    selectedFiles,
    chunksFound:
      chunks.length,
  }
);

}

  const embeddings =
    await db.query.chunkEmbeddings.findMany();
  const fileRecords =
  await db.query.files.findMany();

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

    const file =
  fileRecords.find(
    f =>
      f.id ===
      chunk.fileId
  );

    const semanticScore =
  cosineSimilarity(
    queryEmbedding,
    embeddingRow.embedding as number[]
  );

const keywordBoost =
  keywordScore(
    query,
    chunk.content
  );

const score =
  semanticScore * 0.8 +
  keywordBoost * 0.2;

    results.push({
      chunkId:
        chunk.id,

      fileId:
        chunk.fileId,

      fileName:
        file?.name ??
        "Unknown File",

      content:
        chunk.content,

      score,
    });

  }

  results.sort(
  (a, b) =>
    b.score -
    a.score
);

results.sort(
  (a, b) =>
    b.score - a.score
);

const bestScore =
  results.length > 0
    ? results[0].score
    : 0;

const dynamicThreshold =
  Math.max(
    0.35,
    bestScore - 0.15
  );

const filtered =
  results.filter(
    r =>
      r.score >=
      dynamicThreshold
  );

  console.log(
  "[RAG]",
  {
    candidates:
      results.length,

    bestScore,

    threshold:
      dynamicThreshold,

    selected:
      filtered.length,
  }
);

const grouped =
  new Map<
    string,
    typeof filtered
  >();

for (
  const chunk
  of filtered
) {

  const key =
    `${chunk.fileId}`;

  if (
    !grouped.has(key)
  ) {

    grouped.set(
      key,
      []
    );

  }

  grouped
    .get(key)!
    .push(chunk);

}

const selected = [];

for (
  const [, fileChunks]
  of grouped
) {

  selected.push(
    ...fileChunks.slice(
      0,
      2
    )
  );

}

selected.sort(
  (a, b) =>
    b.score -
    a.score
);

return {

  bestScore,

  chunks:
    selected.slice(
      0,
      limit
    ),

};

}