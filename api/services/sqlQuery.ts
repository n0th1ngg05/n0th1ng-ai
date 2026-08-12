import {
  getDb,
} from "../queries/connection";

export async function
getDatabaseStats() {

  const db =
    getDb();

  const conversations =
    await db.query.conversations.findMany();

  const messages =
    await db.query.messages.findMany();

  const files =
    await db.query.files.findMany();

  return {
    conversations:
      conversations.length,

    messages:
      messages.length,

    files:
      files.length,
  };

}