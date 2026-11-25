/**
 * Resolve the real client IP.
 *
 * Behind the Cloudflare tunnel the app is only reachable through cloudflared
 * (port bound to 127.0.0.1), so `CF-Connecting-IP` is set by Cloudflare itself
 * and cannot be forged by the visitor. The first `X-Forwarded-For` entry,
 * by contrast, is whatever the client sent, so it is only a last-resort fallback.
 */
export function resolveClientIp(getHeader: (name: string) => string | null | undefined): string {
  const cf = getHeader("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = getHeader("x-forwarded-for")?.split(",")[0].trim();
  if (xff) return xff;
  return "127.0.0.1";
}
