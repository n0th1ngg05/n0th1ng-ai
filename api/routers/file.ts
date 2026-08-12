import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  files,
  fileFolders,
} from "@db/schema";
import {
  eq,
  desc,
  like,
} from "drizzle-orm";

export const fileRouter =
  createRouter({

    list: publicQuery
      .input(
        z.object({
          folderId:
            z.number().optional(),
        }).optional()
      )
      .query(async ({ input }) => {

        const db =
          getDb();

        const folders =
          await db.query.fileFolders.findMany({
            orderBy: [
              desc(
                fileFolders.createdAt
              ),
            ],
          });

        let filesQuery;

        if (
          input?.folderId
        ) {

          filesQuery =
            await db.query.files.findMany({
              where: eq(
                files.folderId,
                input.folderId
              ),
              orderBy: [
                desc(
                  files.createdAt
                ),
              ],
            });

        } else {

          filesQuery =
            await db.query.files.findMany({
              orderBy: [
                desc(
                  files.createdAt
                ),
              ],
            });

        }

        return {
          folders,
          files: filesQuery,
        };

      }),

    listFolders:
      publicQuery.query(
        async () => {

          const db =
            getDb();

          return db.query.fileFolders.findMany({
            orderBy: [
              desc(
                fileFolders.createdAt
              ),
            ],
          });

        }
      ),

    createFolder:
      publicQuery
        .input(
          z.object({
            name:
              z.string(),

            parentId:
              z.number().optional(),
          })
        )
        .mutation(
          async ({ input }) => {

            const db =
              getDb();

            const result =
              await db
                .insert(
                  fileFolders
                )
                .values({
                  name:
                    input.name,

                  parentId:
                    input.parentId ??
                    null,
                });

            return {
              id: Number(
                result[0]
                  .insertId
              ),
            };

          }
        ),

    deleteFolder:
      publicQuery
        .input(
          z.object({
            id:
              z.number(),
          })
        )
        .mutation(
          async ({ input }) => {

            const db =
              getDb();

            await db
              .delete(
                fileFolders
              )
              .where(
                eq(
                  fileFolders.id,
                  input.id
                )
              );

            return {
              success: true,
            };

          }
        ),

    create: publicQuery
      .input(
        z.object({
          name:
            z.string(),

          path:
            z.string(),

          size:
            z.number().optional(),

          mimeType:
            z.string().optional(),

          folderId:
            z.number().optional(),
        })
      )
      .mutation(
        async ({ input }) => {

          const db =
            getDb();

          const result =
            await db
              .insert(files)
              .values({
                ...input,

                folderId:
                  input.folderId ??
                  null,

                size:
                  input.size ??
                  null,

                mimeType:
                  input.mimeType ??
                  null,
              });

          return {
            id: Number(
              result[0]
                .insertId
            ),
          };

        }
      ),

    delete: publicQuery
      .input(
        z.object({
          id:
            z.number(),
        })
      )
      .mutation(
        async ({ input }) => {

          const db =
            getDb();

          await db
            .delete(files)
            .where(
              eq(
                files.id,
                input.id
              )
            );

          return {
            success: true,
          };

        }
      ),

    search: publicQuery
      .input(
        z.object({
          query:
            z.string(),
        })
      )
      .query(
        async ({ input }) => {

          const db =
            getDb();

          return db.query.files.findMany({
            where: like(
              files.name,
              `%${input.query}%`
            ),

            limit: 20,
          });

        }
      ),

  });