import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { listProviders, type MediaType } from "../services/providers";

export const providersRouter = createRouter({
  // Returns the provider list for a given media type, in the shape the
  // dropdown needs (id + label only - defaults/file paths stay server-side,
  // no reason to leak folder layout to the client).
  list: publicQuery
    .input(z.object({ mediaType: z.enum(["image", "video"]) }))
    .query(({ input }) => {
      const providers = listProviders(input.mediaType as MediaType);
      return providers.map((p) => ({
        id: p.id,
        label: p.label,
        executor: p.executor,
      }));
    }),
});