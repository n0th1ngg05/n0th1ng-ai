import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { fileContents } from "@db/schema";
import { eq } from "drizzle-orm";

export const fileContentRouter =
  createRouter({

    getByFileId:
      publicQuery
        .input(
          z.object({
            fileId: z.number(),
          })
        )
        .query(
          async ({ input }) => {

            const db =
              getDb();

            return db.query.fileContents.findFirst({
              where: eq(
                fileContents.fileId,
                input.fileId
              ),
            });

          }
        ),

  });