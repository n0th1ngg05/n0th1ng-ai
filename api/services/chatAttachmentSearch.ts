import { getDb } from "../queries/connection";

import {
    chatAttachments,
    chatAttachmentChunks,
    chatAttachmentEmbeddings,
} from "@db/schema";

import { eq, inArray } from "drizzle-orm";

import { generateEmbedding } from "./embeddingService";
import { cosineSimilarity } from "./vectorSearch";

export async function searchChatAttachments(

    conversationId: number,

    query: string,

    limit = 8,

) {

    const db = getDb();

    const queryEmbedding =
        await generateEmbedding(query);

    const attachments =
        await db
            .select({
                id: chatAttachments.id,
            })
            .from(chatAttachments)
            .where(
                eq(
                    chatAttachments.conversationId,
                    conversationId
                )
            );

    if (
        attachments.length === 0
    ) {

        return [];

    }

    const attachmentIds =
        attachments.map(
            a => Number(a.id)
        );

    const chunks =
        await db
            .select({

                chunkId:
                    chatAttachmentChunks.id,

                attachmentId:
                    chatAttachmentChunks.attachmentId,

                content:
                    chatAttachmentChunks.content,

                embedding:
                    chatAttachmentEmbeddings.embedding,

            })

            .from(
                chatAttachmentChunks
            )

            .innerJoin(

                chatAttachmentEmbeddings,

                eq(

                    chatAttachmentChunks.id,

                    chatAttachmentEmbeddings.chunkId

                )

            )

            .where(

                inArray(

                    chatAttachmentChunks.attachmentId,

                    attachmentIds

                )

            );

    return chunks

        .map(chunk => ({

            ...chunk,

            score:
                cosineSimilarity(

                    queryEmbedding,

                    chunk.embedding as number[]

                ),

        }))

        .sort(

            (a, b) =>

                b.score - a.score

        )

        .slice(0, limit);

}