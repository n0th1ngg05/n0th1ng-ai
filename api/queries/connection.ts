// connection.ts
//
// IMPORTANT: Do NOT add top-level synchronous imports of @db/schema or
// @db/relations here. Those imports trigger a fetchModule RPC chain in
// Vite's SSR module runner for every file that transitively imports this
// module. With ~20 such files loaded simultaneously at startup the 60-second
// RPC timeout is reliably hit, producing:
//   "transport invoke timed out … /db/relations.ts"
//
// Fix: kick off the heavy import in the background immediately (so it
// finishes well before the first real request), but don't block the
// module-evaluation path. getDb() then returns the cached instance
// synchronously from every call site that imports it.

import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";

type DrizzleInstance = ReturnType<typeof drizzle<any>>;
let instance: DrizzleInstance | undefined;
let initPromise: Promise<DrizzleInstance> | undefined;

function initDb(): Promise<DrizzleInstance> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const schema    = await import("@db/schema");
    const relations = await import("@db/relations");
    const fullSchema = { ...schema, ...relations };
    instance = drizzle(env.databaseUrl, {
      mode: "planetscale",
      schema: fullSchema,
    }) as DrizzleInstance;
    return instance;
  })();
  return initPromise;
}

// Kick off the DB init immediately when this module is first imported,
// but without blocking (no top-level await). By the time any HTTP handler
// fires, the drizzle instance will already be ready.
initDb().catch((err) =>
  console.error("[DB] Background init failed:", err)
);

/**
 * Returns the drizzle instance synchronously.
 * Safe to call from any request handler — by the time a real request
 * arrives the background init started above will have completed.
 * If called extremely early (e.g. during a test before any tick), use
 * getDbAsync() instead.
 */
export function getDb(): DrizzleInstance {
  if (!instance) {
    // Should not happen in normal operation — initDb() fires at import time
    // and completes in <100 ms. If you hit this, ensure getDbAsync() has
    // been awaited before calling getDb() in your test/bootstrap code.
    throw new Error(
      "[DB] getDb() called before initialization completed. " +
      "Await getDbAsync() once before using getDb() in startup paths."
    );
  }
  return instance;
}

/** Async version — always resolves with a ready instance. */
export async function getDbAsync(): Promise<DrizzleInstance> {
  return initDb();
}
