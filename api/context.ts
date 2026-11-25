import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { verifySession } from "./services/auth.service";
import { resolveClientIp } from "./lib/clientIp";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  session: any | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const cookieHeader = opts.req.headers.get("cookie");
  let session = null;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)n0th1ng_session=([^;]*)/);
    if (match) {
      const cookieValue = decodeURIComponent(match[1]);
      const clientIp = resolveClientIp((n) => opts.req.headers.get(n));
      session = await verifySession(cookieValue, clientIp);
    }
  }

  return { req: opts.req, resHeaders: opts.resHeaders, session };
}

