import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import { getDb } from "../queries/connection";
import { files, fileContents, knowledgeChunks } from "@db/schema";
import { extractText } from "./fileProcessor";
import { createChunks } from "./chunker";
import {
  chunkEmbeddings,
} from "@db/schema";
import { eq } from "drizzle-orm";
import {
  generateEmbedding,
} from "./embeddingService";
import { processDocument } from "./documentProcessor";


// Assuming you have your Drizzle (or similar) DB instance and schema defined elsewhere
// import { db } from '../db';
// import { files } from '../db/schema';

const fileUploadRouter = new Hono();

fileUploadRouter.post('/upload', async (c) => {
  try {
    // 1. Parse the incoming Multipart Form Data
    const body = await c.req.parseBody();
    const file = body['file']; // Extract the File blob
    const rawFolderId = body['folderId'];
    
    // Parse folderId (safeguard against string/null types)
    const folderId = rawFolderId ? Number(rawFolderId) : null;

    if (!file || typeof file === 'string') {
      return c.json({ success: false, error: 'Invalid or missing file.' }, 400);
    }

    // 2. Define and verify the /uploads target directory
    const uploadDir = path.join(process.cwd(), 'uploads');
    
    // Create the 'uploads' directory if it is missing
    await fs.mkdir(uploadDir, { recursive: true });

    // 3. Prevent Filename Collisions
    // We add a timestamp to the original filename to guarantee uniqueness on disk
    const originalName = file.name;
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const diskFileName = `${Date.now()}-${sanitizedName}`;
    const physicalPath = path.join(uploadDir, diskFileName);
    const databasePath = `uploads/${diskFileName}`;

    // 4. Save the file to the local disk
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(physicalPath, buffer);

    // 5. Insert metadata into the database
    const db = getDb();

const result =
  await db.insert(files).values({
    name: originalName,
    path: databasePath,
    size: file.size,
    mimeType:
      file.type ||
      "application/octet-stream",
    folderId,
    isIndexed: false,
  });

const fileId =
  Number(
    result[0].insertId
  );

try {

  const document =
    await processDocument(
      physicalPath,
      file.type ||
      "application/octet-stream"
    );

  if (
    document.text.trim().length > 0
  ) {

    await db
      .insert(fileContents)
      .values({
        fileId,
        content: document.text,
      });

    for (
      let i = 0;
      i < document.chunks.length;
      i++
    ) {

      const chunkResult =
        await db
          .insert(
            knowledgeChunks
          )
          .values({
            fileId,
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
          chunkEmbeddings
        )
        .values({

          chunkId,

          embedding:
            document.embeddings[i],

        });

    }

    await db
      .update(files)
      .set({
        isIndexed: true,
      })
      .where(
        eq(
          files.id,
          fileId
        )
      );

  }

} catch (err) {

  console.error(
    "Document processing failed:",
    err
  );

}

    // 6. Return Success Response to Frontend
    return c.json({ 
      success: true,
      fileId, // Return the file ID for frontend reference 
      // fileId: insertedFile.id // Provide this if you need it on the frontend immediately
    });

  } catch (error) {
    console.error('File Upload Pipeline Error:', error);
    return c.json({ 
      success: false, 
      error: 'An internal server error occurred during upload.' 
    }, 500);
  }
});

export default fileUploadRouter;