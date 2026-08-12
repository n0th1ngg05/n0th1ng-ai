import { getDb } from "../queries/connection";
import {
  memories,
  memoryChunks,
  memoryChunkEmbeddings,
} from "@db/schema";

import {
  desc,
  eq,
} from "drizzle-orm";

import {
  searchMemories,
} from "./memorySemanticSearch";

import {
  generateEmbedding,
} from "./embeddingService";

export async function memoryStore(
  category: string,
  key: string,
  value: string,
  source?: string
) {
  const db = getDb();

  const existingMemory =
    await db.query.memories.findFirst({
      where: eq(memories.key, key),
    });

  if (existingMemory) {

    await db
      .update(memories)
      .set({
        category,
        value,
        source,
        updatedAt: new Date(),
      })
      .where(eq(memories.key, key));

    const memory =
      await db.query.memories.findFirst({
        where: eq(memories.key, key),
      });

    if (!memory) {
      throw new Error(
        "Memory not found."
      );
    }

    const searchableText = `
Category: ${memory.category}

Key: ${memory.key}

Value: ${memory.value}
`;

    const embedding =
      await generateEmbedding(
        searchableText
      );

    const chunk =
      await db.query.memoryChunks.findFirst({
        where: eq(
          memoryChunks.memoryId,
          memory.id
        ),
      });

    if (!chunk) {
      throw new Error(
        "Memory chunk not found."
      );
    }

    await db
      .update(memoryChunks)
      .set({
        content: searchableText,
      })
      .where(
        eq(memoryChunks.id, chunk.id)
      );

    await db
      .update(memoryChunkEmbeddings)
      .set({
        embedding,
      })
      .where(
        eq(
          memoryChunkEmbeddings.chunkId,
          chunk.id
        )
      );

    return {
      success: true,
    };

  }

  await db
    .insert(memories)
    .values({
      category,
      key,
      value,
      source,
    });

  const memory =
    await db.query.memories.findFirst({
      where: eq(memories.key, key),
    });

  if (!memory) {
    throw new Error(
      "Failed to retrieve stored memory."
    );
  }

  const searchableText = `
Category: ${category}

Key: ${key}

Value: ${value}
`;

  const embedding =
    await generateEmbedding(
      searchableText
    );

  await db
    .insert(memoryChunks)
    .values({
      memoryId: memory.id,
      content: searchableText,
    });

  const chunk =
    await db.query.memoryChunks.findFirst({
      where: eq(
        memoryChunks.memoryId,
        memory.id
      ),
    });

  if (!chunk) {
    throw new Error(
      "Failed to retrieve memory chunk."
    );
  }

  await db
    .insert(memoryChunkEmbeddings)
    .values({
      chunkId: chunk.id,
      embedding,
    });

  return {
    success: true,
  };
}

export async function memorySearch(
  query: string
) {
  const results =
    await searchMemories(
      query
    );

  return results.chunks;
}

export async function getAllMemories() {
  const db = getDb();

  return await db
    .select()
    .from(memories)
    .orderBy(
      desc(memories.createdAt)
    );
}

export async function memoryUpdate(
  key: string,
  value: string
) {
  const db = getDb();

  const existingMemory =
    await db.query.memories.findFirst({
      where: eq(memories.key, key),
    });

  if (!existingMemory) {
    // No existing row to update — this is really a new fact. Rather than
    // hard-failing with "Memory not found." (which previously killed the
    // whole tool call whenever the router picked memory_update for a key
    // that had never been stored before), fall back to storing it fresh.
    // memory_update's signature has no `category` param, so default to
    // "Personal" — matches memory_store's own doc-comment example category.
    console.warn(
      `[MEMORY] memoryUpdate called for key "${key}" with no existing row — ` +
      `falling back to memoryStore (treating as a new fact).`
    );
    return memoryStore("Personal", key, value, "memory_update_fallback");
  }

  await db
    .update(memories)
    .set({
      value,
      updatedAt: new Date(),
    })
    .where(
      eq(memories.key, key)
    );

  const memory =
    await db.query.memories.findFirst({
      where: eq(memories.key, key),
    });

  if (!memory) {
    throw new Error(
      "Memory not found."
    );
  }

  const searchableText = `
Category: ${memory.category}

Key: ${memory.key}

Value: ${memory.value}
`;

  const embedding =
    await generateEmbedding(
      searchableText
    );

  const chunk =
    await db.query.memoryChunks.findFirst({
      where: eq(
        memoryChunks.memoryId,
        memory.id
      ),
    });

  if (!chunk) {
    throw new Error(
      "Memory chunk not found."
    );
  }

  await db
    .update(memoryChunks)
    .set({
      content: searchableText,
    })
    .where(
      eq(memoryChunks.id, chunk.id)
    );

  await db
    .update(memoryChunkEmbeddings)
    .set({
      embedding,
    })
    .where(
      eq(
        memoryChunkEmbeddings.chunkId,
        chunk.id
      )
    );

  return {
    success: true,
  };
}

export async function memoryDelete(
  key: string
) {
  const db = getDb();

  await db
    .delete(memories)
    .where(
      eq(memories.key, key)
    );

  return {
    success: true,
  };
}