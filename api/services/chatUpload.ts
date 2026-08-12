import { Hono } from "hono";
import fs from "fs/promises";
import path from "path";

import { getDb } from "../queries/connection";

import { processDocument } from "./documentProcessor";

import { chatAttachments, chatAttachmentChunks, chatAttachmentEmbeddings, } from "@db/schema";

const chatUploadRouter = new Hono();

chatUploadRouter.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody({ all: true });

    const rawConversationId = body.conversationId;

    const conversationId = Number(rawConversationId);

    if (!conversationId || Number.isNaN(conversationId)) {
      return c.json(
        {
          success: false,
          error: "Invalid conversationId.",
        },
        400
      );
    }

    let uploadedFiles = body.files ?? body.file;

    if (!uploadedFiles) {
      return c.json(
        {
          success: false,
          error: "No files uploaded.",
        },
        400
      );
    }

    if (!Array.isArray(uploadedFiles)) {
      uploadedFiles = [uploadedFiles];
    }

    const uploadDir = path.join(
      process.cwd(),
      "uploads",
      "chat"
    );

    await fs.mkdir(uploadDir, {
      recursive: true,
    });

    const db = getDb();

    const attachments = [];

    for (const file of uploadedFiles) {
      if (!file || typeof file === "string") continue;

      const originalName = file.name;

      const sanitizedName = originalName.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

      const storedName =
        `${Date.now()}-${Math.random()
          .toString(36)
          .substring(2, 8)}-${sanitizedName}`;

      const physicalPath = path.join(
        uploadDir,
        storedName
      );

      const databasePath =
        `uploads/chat/${storedName}`;

      const buffer = Buffer.from(
        await file.arrayBuffer()
      );

      await fs.writeFile(
        physicalPath,
        buffer
      );

      const document =
    await processDocument(
        physicalPath,
        file.type ||
        "application/octet-stream"
    );

      const result =
        await db
          .insert(chatAttachments)
          .values({
            conversationId,
            originalName,
            storedName,
            path: databasePath,
            mimeType:
              file.type ||
              "application/octet-stream",
            size: file.size,
            extractedText: document.text,
          });

      // TODO:
// Store document.chunks and
// document.embeddings into
// chat_attachment_chunks and
// chat_attachment_embeddings.
// This will enable semantic
// retrieval for attachments
// instead of injecting the
// entire document.

const attachmentId =
    Number(result[0].insertId);

for (
    let i = 0;
    i < document.chunks.length;
    i++
) {

    const chunkResult =
        await db
            .insert(chatAttachmentChunks)
            .values({

                attachmentId,

                chunkIndex: i,

                content:
                    document.chunks[i],

            });

    const chunkId =
        Number(
            chunkResult[0]
                .insertId
        );

    await db
        .insert(
            chatAttachmentEmbeddings
        )
        .values({

            chunkId,

            embedding:
                document.embeddings[i],

        });

}

      attachments.push({
        id: attachmentId,
        originalName,
        storedName,
        path: databasePath,
        mimeType:
          file.type ||
          "application/octet-stream",
        size: file.size,
        metadata: document.metadata,
      });
    }

    return c.json({
      success: true,
      attachments,
    });
  } catch (err) {
    console.error(
      "Chat Upload Error:",
      err
    );

    return c.json(
      {
        success: false,
        error:
          "Failed to upload attachments.",
      },
      500
    );
  }
});

export default chatUploadRouter;