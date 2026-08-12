import { getDb } from "../queries/connection";
import {
  knowledgeChunks,
  chunkEmbeddings,
} from "@db/schema";

import { generateEmbedding }
  from "./embeddingService";

export async function
backfillEmbeddings() {

  const db =
    getDb();

  const chunks =
    await db.query.knowledgeChunks.findMany();

  for (
    const chunk
    of chunks
  ) {

    const existing =
      await db.query.chunkEmbeddings.findFirst({
        where: (
          fields,
          { eq }
        ) =>
          eq(
            fields.chunkId,
            chunk.id
          ),
      });

    if (existing) {
      continue;
    }

    console.log(
      "Embedding chunk:",
      chunk.id
    );

    const embedding =
      await generateEmbedding(
        chunk.content
      );

    await db
      .insert(
        chunkEmbeddings
      )
      .values({
        chunkId:
          chunk.id,

        embedding,
      });

  }

  console.log(
    "Backfill complete"
  );

}