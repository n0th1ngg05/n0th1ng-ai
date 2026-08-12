import { getDb } from "./connection";
import { conversations } from "@db/schema";
import { eq } from "drizzle-orm";

export async function getConversationSummary(
  conversationId: number
) {
  const db = getDb();

  const conversation =
    await db.query.conversations.findFirst({
      where: eq(
        conversations.id,
        conversationId
      ),
    });

  return conversation?.summary ?? "";
}

export async function updateConversationSummary(
  conversationId: number,
  summary: string
) {
  const db = getDb();

  await db
    .update(conversations)
    .set({
      summary,
      updatedAt: new Date(),
    })
    .where(
      eq(
        conversations.id,
        conversationId
      )
    );
}

// NEW: tracks how many "overflow" (older-than-context-window) messages the
// currently stored summary already covers. Used by contextWindow.ts to
// decide whether the summary is stale and needs regenerating.
export async function getConversationSummarizedCount(
  conversationId: number
): Promise<number> {
  const db = getDb();

  const conversation =
    await db.query.conversations.findFirst({
      where: eq(
        conversations.id,
        conversationId
      ),
    });

  return conversation?.summarizedMessageCount ?? 0;
}

// NEW: updates both the summary text and the count of messages it covers
// in one write. Prefer this over updateConversationSummary() going forward
// so the two never drift out of sync.
export async function updateConversationSummaryWithCount(
  conversationId: number,
  summary: string,
  summarizedMessageCount: number
) {
  const db = getDb();

  await db
    .update(conversations)
    .set({
      summary,
      summarizedMessageCount,
      updatedAt: new Date(),
    })
    .where(
      eq(
        conversations.id,
        conversationId
      )
    );
}