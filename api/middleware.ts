import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/**
 * Phase 6: Elevated procedure for Forge / ForgeX execution.
 * Requires an active operator session with scope: "forge_unlocked".
 * Sessions unlocked with a quick PIN (scope: "standard") or sessions
 * that have auto-demoted due to inactivity (30m) will receive:
 * FORBIDDEN with message "ELEVATION_REQUIRED".
 */
export const elevatedForgeProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    });
  }

  if (ctx.session.scope !== "forge_unlocked") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "ELEVATION_REQUIRED",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

