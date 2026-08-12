import { getDb } from "../queries/connection";

export async function getConversationMemory(
  conversationId: number,
  limit = 12
) {

  const db =
    getDb();

  const messages =
  await db.query.messages.findMany({
    where: (message, { eq }) =>
      eq(message.conversationId, conversationId),
    orderBy: (message, { asc }) => asc(message.createdAt),
  });

  const recent =
    messages
      .slice(-limit);

  return recent
    .map(
      m =>
`
${m.role.toUpperCase()}:

${m.content}
`
    )
    .join("\n");
}

export async function getConversationMessages(
  conversationId: number
) {
  const db = getDb();

  return await db.query.messages.findMany({
    where: (message, { eq }) =>
      eq(message.conversationId, conversationId),
    orderBy: (message, { asc }) =>
      asc(message.createdAt),
  });
}