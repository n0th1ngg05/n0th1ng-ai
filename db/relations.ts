import { relations } from "drizzle-orm";
import { messages, messageToolCalls } from "./schema";
// ^ keeping the same "./schema" import path your existing (stub) relations.ts
//   already used — just filling in the actual relation definitions it was
//   missing.

// Required for the relational query API (`db.query.messages.findMany`,
// `db.query.messageToolCalls.findMany`) used in routers/message.ts. Without
// this file, getDb() still builds fine (fullSchema just won't have `.query`
// entries for these two tables), but any call to db.query.messages... or
// db.query.messageToolCalls... throws at runtime with something like
// "Cannot read properties of undefined (reading 'findMany')" — this is
// almost certainly the "discrepancy" being hit, on top of the raw SQL drift.
export const messagesRelations = relations(messages, ({ many }) => ({
  toolCalls: many(messageToolCalls),
}));

export const messageToolCallsRelations = relations(messageToolCalls, ({ one }) => ({
  message: one(messages, {
    fields: [messageToolCalls.messageId],
    references: [messages.id],
  }),
}));