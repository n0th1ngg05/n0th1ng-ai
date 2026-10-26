import { Hono } from "hono";
import {
  hasMasterPassword,
  setMasterPassword,
  verifyMasterPassword,
  createSession,
  verifySession,
  revokeSession,
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
  recordAudit,
  isRequestSecure,
  SESSION_COOKIE_NAME,
} from "../services/auth.service";

export const authRouter = new Hono();

function getClientIp(c: any): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return c.req.header("cf-connecting-ip") || "127.0.0.1";
}

function parseCookie(c: any, name: string): string | undefined {
  const header = c.req.header("cookie");
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function buildSetCookieHeader(name: string, value: string, maxAgeSeconds: number, isSecure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET /api/auth/status
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get("/status", async (c) => {
  const configured = await hasMasterPassword();
  return c.json({ configured });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/auth/setup (First-Run Initialization ONLY)
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post("/setup", async (c) => {
  const alreadyConfigured = await hasMasterPassword();
  if (alreadyConfigured) {
    return c.json({ error: "Master password is already initialized. Use CLI recovery if forgotten." }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.password || body.password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters long." }, 400);
  }

  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  await setMasterPassword(body.password);
  await recordAudit({ method: "setup", success: true, ip, userAgent });

  // Automatically sign the user in upon first setup
  const isSecure = isRequestSecure(c.req.raw);
  const { cookieValue, expiresAt } = await createSession({
    methodUsed: "password",
    deviceLabel: body.deviceLabel,
    ip,
    rememberMe: true,
  });

  const cookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, cookieValue, 30 * 24 * 60 * 60, isSecure);
  c.header("Set-Cookie", cookieHeader);

  return c.json({ ok: true, message: "Workstation initialized successfully.", expiresAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post("/login", async (c) => {
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  // Check rate limit
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    await recordAudit({
      method: "password",
      success: false,
      ip,
      userAgent,
      failureReason: "Rate limit exceeded",
    });
    return c.json(
      {
        error: `Too many failed login attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.`,
      },
      429
    );
  }

  // Progressive delay if attempts >= 3
  if (rateLimit.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, rateLimit.delayMs));
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.password) {
    return c.json({ error: "Password is required." }, 400);
  }

  const isValid = await verifyMasterPassword(body.password);

  if (!isValid) {
    recordRateLimitFailure(ip);
    await recordAudit({
      method: "password",
      success: false,
      ip,
      userAgent,
      failureReason: "Invalid password",
    });
    return c.json({ error: "Invalid master password." }, 401);
  }

  // Success: Clear rate limits & mint session
  clearRateLimit(ip);
  await recordAudit({ method: "password", success: true, ip, userAgent });

  const isSecure = isRequestSecure(c.req.raw);
  const rememberMe = body.rememberMe !== false;
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;

  const { cookieValue, expiresAt } = await createSession({
    methodUsed: "password",
    deviceLabel: body.deviceLabel,
    ip,
    rememberMe,
    scope: "standard",
  });

  const cookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, cookieValue, maxAge, isSecure);
  c.header("Set-Cookie", cookieHeader);

  return c.json({ ok: true, expiresAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post("/logout", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  if (cookieValue) {
    // Invalidate the session in database
    const dotIndex = cookieValue.indexOf(".");
    const sessionId = dotIndex !== -1 ? cookieValue.slice(0, dotIndex) : cookieValue;
    await revokeSession(sessionId).catch(() => {});
  }

  const isSecure = isRequestSecure(c.req.raw);
  const clearCookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, "", 0, isSecure);
  c.header("Set-Cookie", clearCookieHeader);

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get("/me", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const ip = getClientIp(c);
  const session = await verifySession(cookieValue, ip);

  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  return c.json({
    authenticated: true,
    session: {
      id: session.id,
      scope: session.scope,
      methodUsed: session.methodUsed,
      deviceLabel: session.deviceLabel,
      expiresAt: session.expiresAt,
    },
  });
});
