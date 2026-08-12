import { asc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { voiceMessages, voiceConversations } from "../../db/schema";

export async function getVoiceConversationMemory(
    conversationId: string,
    limit = 12
) {

    const db = getDb();

    const messages = await db
        .select()
        .from(voiceMessages)
        .where(
            eq(
                voiceMessages.conversationId,
                conversationId
            )
        )
        .orderBy(
            asc(
                voiceMessages.createdAt
            )
        );

    return messages
        .slice(-limit)
        .map(
            m =>

`${m.role.toUpperCase()}:

${m.content ?? ""}

`
        )
        .join("\n");

}
export async function getVoiceConversationMessages(
    conversationId: string
) {

    const db = getDb();

    return db
        .select()
        .from(voiceMessages)
        .where(
            eq(
                voiceMessages.conversationId,
                conversationId
            )
        )
        .orderBy(
            asc(
                voiceMessages.createdAt
            )
        );

}
export async function getVoiceConversationSummary(
    conversationId: string
): Promise<string> {

    const db = getDb();

    const conversation = await db
        .select()
        .from(voiceConversations)
        .where(
            eq(
                voiceConversations.id,
                conversationId
            )
        );

    return conversation[0]?.summary ?? "";
}

// NEW: mirrors getConversationSummarizedCount() for voice conversations.
export async function getVoiceConversationSummarizedCount(
    conversationId: string
): Promise<number> {

    const db = getDb();

    const conversation = await db
        .select()
        .from(voiceConversations)
        .where(
            eq(
                voiceConversations.id,
                conversationId
            )
        );

    return conversation[0]?.summarizedMessageCount ?? 0;
}

export async function updateVoiceConversationSummary(
    conversationId: string,
    summary: string,
    summarizedMessageCount?: number
) {

    const db = getDb();

    await db
        .update(voiceConversations)
        .set({
            summary,
            ...(summarizedMessageCount !== undefined
                ? { summarizedMessageCount }
                : {}),
            updatedAt: new Date(),
        })
        .where(
            eq(
                voiceConversations.id,
                conversationId
            )
        );
}