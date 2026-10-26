import { createRouter, publicQuery, elevatedForgeProcedure } from "../middleware";
import { runtimeManager } from "../services/runtime/manager";

/**
 * Exposes the Python runtime's real lifecycle controls
 * (services/runtime/manager.ts) over tRPC. That manager already does
 * everything needed here — start(), stop(), status() — it just wasn't
 * mounted on any router before this.
 */
export const runtimeRouter = createRouter({
  python: createRouter({
    status: publicQuery.query(() => {
      return runtimeManager.status();
    }),

    start: elevatedForgeProcedure.mutation(async () => {
      await runtimeManager.start();
      return runtimeManager.status();
    }),

    stop: elevatedForgeProcedure.mutation(async () => {
      await runtimeManager.stop();
      return runtimeManager.status();
    }),
  }),
});