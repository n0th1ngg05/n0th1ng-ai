import { Hono } from "hono";
import {
  hasMasterPassword,
  setMasterPassword,
  verifyMasterPassword,
  createSession,
  verifySession,
  revokeSession,
  revokeAllSessions,
  checkRateLimit,
  recordRateLimitFailure,
  clearRateLimit,
  recordAudit,
  isRequestSecure,
  SESSION_COOKIE_NAME,
  hasTotpEnabled,
  createPendingTotpToken,
  getPendingTotpToken,
  deletePendingTotpToken,
  verifyTotpLogin,
  enrollTotp,
  confirmTotpEnrollment,
  disableTotp,
  DEVICE_TRUST_COOKIE_NAME,
  DEVICE_TRUST_TTL_SECONDS,
  createDeviceTrust,
  getDeviceTrust,
  verifyDevicePin,
  setDevicePin,
  revokeDeviceTrust,
  hasWebAuthnCredentials,
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  getWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
  getWebAuthnLoginOptions,
  verifyWebAuthnLogin,
  elevateSession,
  demoteSession,
} from "../services/auth.service";
import {
  getCloudflareAccessConfig,
  extractCloudflareToken,
} from "../services/cloudflare.service";

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
    scope: "forge_unlocked",
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

  // Check if TOTP second-factor is enabled on the workstation
  const totpRequired = await hasTotpEnabled();
  if (totpRequired) {
    // Generate a single-purpose, 5-minute pending token. NO session cookie is set.
    const pendingToken = createPendingTotpToken({
      ip,
      rememberMe: body.rememberMe !== false,
      deviceLabel: body.deviceLabel,
      trustDevice: body.trustDevice === true || Boolean(body.pin),
      pin: body.pin,
    });
    return c.json({ ok: true, totpRequired: true, pendingToken });
  }

  // Password-only success: Clear rate limits & mint session
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
    scope: "forge_unlocked",
  });

  const cookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, cookieValue, maxAge, isSecure);
  c.header("Set-Cookie", cookieHeader);

  // If operator requested device trust / quick PIN
  if (body.trustDevice === true || body.pin) {
    try {
      const trust = await createDeviceTrust({
        pin: body.pin,
        deviceFingerprint: body.deviceLabel,
      });
      const trustCookieHeader = buildSetCookieHeader(
        DEVICE_TRUST_COOKIE_NAME,
        trust.cookieValue,
        DEVICE_TRUST_TTL_SECONDS,
        isSecure
      );
      c.header("Set-Cookie", trustCookieHeader, { append: true });
      await recordAudit({ method: "device_trust_setup", success: true, ip, userAgent });
    } catch (err) {
      console.error("[Auth] Error creating device trust on login:", err);
    }
  }

  return c.json({ ok: true, expiresAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /api/auth/totp/verify-login (Second-Factor Authentication)
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post("/totp/verify-login", async (c) => {
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  // Apply rate limiter
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    await recordAudit({
      method: "totp",
      success: false,
      ip,
      userAgent,
      failureReason: "Rate limit exceeded",
    });
    return c.json(
      {
        error: `Too many failed attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.`,
      },
      429
    );
  }

  if (rateLimit.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, rateLimit.delayMs));
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.pendingToken || !body.code) {
    return c.json({ error: "Pending token and 6-digit code are required." }, 400);
  }

  // Look up pending token (5-minute hard expiry)
  const pending = getPendingTotpToken(body.pendingToken);
  if (!pending) {
    return c.json({ error: "Authentication timeout. Please enter your password again." }, 410);
  }

  // Verify TOTP code with time drift (±1 window) & replay protection
  const result = await verifyTotpLogin(body.code);

  if (!result.valid) {
    pending.attempts += 1;
    recordRateLimitFailure(ip);
    await recordAudit({
      method: "totp",
      success: false,
      ip,
      userAgent,
      failureReason: result.reason || "Invalid code",
    });

    const errorMsg =
      result.reason === "code_already_used"
        ? "This code has already been used. Please wait for the next 30-second code."
        : "Invalid authentication code.";
    return c.json({ error: errorMsg }, 401);
  }

  // Success: Clear rate limits, destroy pending token, and mint session
  clearRateLimit(ip);
  deletePendingTotpToken(body.pendingToken);
  await recordAudit({ method: "totp", success: true, ip, userAgent });

  const isSecure = isRequestSecure(c.req.raw);
  const maxAge = pending.rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;

  const { cookieValue, expiresAt } = await createSession({
    methodUsed: "totp",
    deviceLabel: pending.deviceLabel,
    ip,
    rememberMe: pending.rememberMe,
    scope: "forge_unlocked",
  });

  const cookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, cookieValue, maxAge, isSecure);
  c.header("Set-Cookie", cookieHeader);

  // If operator requested device trust / quick PIN during initial password step
  if (pending.trustDevice === true || pending.pin) {
    try {
      const trust = await createDeviceTrust({
        pin: pending.pin,
        deviceFingerprint: pending.deviceLabel,
      });
      const trustCookieHeader = buildSetCookieHeader(
        DEVICE_TRUST_COOKIE_NAME,
        trust.cookieValue,
        DEVICE_TRUST_TTL_SECONDS,
        isSecure
      );
      c.header("Set-Cookie", trustCookieHeader, { append: true });
      await recordAudit({ method: "device_trust_setup", success: true, ip, userAgent });
    } catch (err) {
      console.error("[Auth] Error creating device trust on TOTP login:", err);
    }
  }

  return c.json({ ok: true, expiresAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Protected TOTP Management (Enrollment & Status — Requires Active Session)
// ─────────────────────────────────────────────────────────────────────────────
authRouter.get("/totp/status", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const enabled = await hasTotpEnabled();
  return c.json({ enabled });
});

authRouter.post("/totp/enroll", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await enrollTotp();
  return c.json({ ok: true, ...result });
});

authRouter.post("/totp/verify", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return c.json({ error: "Too many attempts. Please wait." }, 429);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.code) {
    return c.json({ error: "Verification code is required." }, 400);
  }

  const confirmResult = await confirmTotpEnrollment(body.code);
  if (!confirmResult.success) {
    recordRateLimitFailure(ip);
    await recordAudit({ method: "totp_enroll", success: false, ip, userAgent, failureReason: confirmResult.error });
    return c.json({ error: confirmResult.error || "Invalid code." }, 401);
  }

  clearRateLimit(ip);
  await recordAudit({ method: "totp_enroll", success: true, ip, userAgent });
  return c.json({ ok: true, message: "Two-factor authentication has been enabled." });
});

authRouter.post("/totp/disable", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.password) {
    return c.json({ error: "Master password is required to disable 2FA." }, 400);
  }

  const isValid = await verifyMasterPassword(body.password);
  if (!isValid) {
    return c.json({ error: "Invalid master password." }, 401);
  }

  await disableTotp();
  return c.json({ ok: true, message: "Two-factor authentication disabled." });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
authRouter.post("/logout", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  if (cookieValue) {
    const dotIndex = cookieValue.indexOf(".");
    const sessionId = dotIndex !== -1 ? cookieValue.slice(0, dotIndex) : cookieValue;
    await revokeSession(sessionId).catch(() => {});
  }

  const isSecure = isRequestSecure(c.req.raw);
  const clearCookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, "", 0, isSecure);
  c.header("Set-Cookie", clearCookieHeader);

  return c.json({ ok: true });
});

authRouter.post("/logout-all", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";
  const session = await verifySession(cookieValue, ip);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await revokeAllSessions();
  await recordAudit({
    method: "logout_all",
    success: true,
    ip,
    userAgent,
  });

  const isSecure = isRequestSecure(c.req.raw);
  const clearCookieHeader = buildSetCookieHeader(SESSION_COOKIE_NAME, "", 0, isSecure);
  c.header("Set-Cookie", clearCookieHeader);

  return c.json({ ok: true, message: "All sessions revoked." });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET /api/auth/me
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

// ─────────────────────────────────────────────────────────────────────────────
// 8. Device Trust & Quick PIN (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

authRouter.get("/device-trust/status", async (c) => {
  const cookieValue = parseCookie(c, DEVICE_TRUST_COOKIE_NAME);
  const device = await getDeviceTrust(cookieValue);

  if (!device) {
    return c.json({ trusted: false, hasPin: false });
  }

  return c.json({
    trusted: true,
    hasPin: Boolean(device.pinHash),
    deviceFingerprint: device.deviceFingerprint,
    expiresAt: device.expiresAt,
  });
});

authRouter.post("/device-trust/setup", async (c) => {
  const sessionCookie = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(sessionCookie);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";
  const isSecure = isRequestSecure(c.req.raw);

  try {
    const trust = await createDeviceTrust({
      pin: body.pin,
      deviceFingerprint: body.deviceFingerprint || body.deviceLabel,
      maxAgeDays: body.maxAgeDays,
    });

    const trustCookieHeader = buildSetCookieHeader(
      DEVICE_TRUST_COOKIE_NAME,
      trust.cookieValue,
      DEVICE_TRUST_TTL_SECONDS,
      isSecure
    );
    c.header("Set-Cookie", trustCookieHeader);

    await recordAudit({ method: "device_trust_setup", success: true, ip, userAgent });

    return c.json({
      ok: true,
      hasPin: Boolean(body.pin),
      expiresAt: trust.expiresAt,
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to establish device trust." }, 400);
  }
});

authRouter.post("/device-trust/revoke", async (c) => {
  const cookieValue = parseCookie(c, DEVICE_TRUST_COOKIE_NAME);
  if (cookieValue) {
    await revokeDeviceTrust(cookieValue).catch(() => {});
  }

  const isSecure = isRequestSecure(c.req.raw);
  const clearCookieHeader = buildSetCookieHeader(DEVICE_TRUST_COOKIE_NAME, "", 0, isSecure);
  c.header("Set-Cookie", clearCookieHeader);

  return c.json({ ok: true, message: "Device trust revoked." });
});

authRouter.post("/pin/unlock", async (c) => {
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  // Check rate limit (same strict limits to protect 4-8 digit PIN space)
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    await recordAudit({
      method: "pin",
      success: false,
      ip,
      userAgent,
      failureReason: "Rate limit exceeded",
    });
    return c.json(
      {
        error: `Too many failed attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.`,
      },
      429
    );
  }

  if (rateLimit.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, rateLimit.delayMs));
  }

  const cookieValue = parseCookie(c, DEVICE_TRUST_COOKIE_NAME);
  if (!cookieValue) {
    return c.json(
      { error: "This device is not trusted. Full authentication is required." },
      401
    );
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.pin) {
    return c.json({ error: "PIN is required." }, 400);
  }

  const result = await verifyDevicePin(cookieValue, body.pin);

  if (!result.valid) {
    recordRateLimitFailure(ip);
    await recordAudit({
      method: "pin",
      success: false,
      ip,
      userAgent,
      failureReason: result.reason || "Invalid PIN",
    });

    if (result.reason === "no_pin") {
      return c.json({ error: "No quick PIN is configured for this device." }, 400);
    }
    if (result.reason === "not_trusted") {
      return c.json({ error: "Device trust has expired. Full authentication is required." }, 401);
    }
    return c.json({ error: "Incorrect PIN." }, 401);
  }

  // Success: Clear rate limits & mint session with scope: "standard"
  clearRateLimit(ip);
  await recordAudit({ method: "pin", success: true, ip, userAgent });

  const isSecure = isRequestSecure(c.req.raw);
  const { cookieValue: sessionCookieValue, expiresAt } = await createSession({
    methodUsed: "pin",
    scope: "standard", // PIN sessions cannot escalate to forge_unlocked without full re-auth
    deviceLabel: result.device?.deviceFingerprint || "Trusted Device",
    ip,
    rememberMe: true,
  });

  const sessionCookieHeader = buildSetCookieHeader(
    SESSION_COOKIE_NAME,
    sessionCookieValue,
    30 * 24 * 60 * 60,
    isSecure
  );
  c.header("Set-Cookie", sessionCookieHeader);

  return c.json({ ok: true, expiresAt });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. WebAuthn / Passkeys (Phase 5)
// ─────────────────────────────────────────────────────────────────────────────

authRouter.get("/webauthn/status", async (c) => {
  const available = await hasWebAuthnCredentials();
  return c.json({ available });
});

authRouter.post("/webauthn/login-options", async (c) => {
  const ip = getClientIp(c);
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return c.json(
      { error: `Too many attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.` },
      429
    );
  }

  const result = await getWebAuthnLoginOptions(c.req.raw);
  return c.json(result);
});

authRouter.post("/webauthn/login-verify", async (c) => {
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    await recordAudit({
      method: "passkey",
      success: false,
      ip,
      userAgent,
      failureReason: "Rate limit exceeded",
    });
    return c.json(
      { error: `Too many attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.` },
      429
    );
  }

  if (rateLimit.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, rateLimit.delayMs));
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Assertion response is required." }, 400);
  }

  const result = await verifyWebAuthnLogin(c.req.raw, body);
  if (!result.verified) {
    recordRateLimitFailure(ip);
    await recordAudit({
      method: "passkey",
      success: false,
      ip,
      userAgent,
      failureReason: result.error || "Verification failed",
    });
    return c.json({ error: result.error || "Passkey authentication failed." }, 401);
  }

  clearRateLimit(ip);
  await recordAudit({ method: "passkey", success: true, ip, userAgent });

  const isSecure = isRequestSecure(c.req.raw);
  const { cookieValue, expiresAt } = await createSession({
    methodUsed: "passkey",
    scope: "forge_unlocked",
    deviceLabel: result.credential?.deviceLabel || "Passkey Device",
    ip,
    rememberMe: true,
  });

  const cookieHeader = buildSetCookieHeader(
    SESSION_COOKIE_NAME,
    cookieValue,
    30 * 24 * 60 * 60,
    isSecure
  );
  c.header("Set-Cookie", cookieHeader);

  return c.json({ ok: true, expiresAt });
});

authRouter.post("/webauthn/register-options", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const options = await getWebAuthnRegistrationOptions(c.req.raw);
    return c.json(options);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to generate registration options." }, 500);
  }
});

authRouter.post("/webauthn/register-verify", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || !body.response) {
    return c.json({ error: "Registration response is required." }, 400);
  }

  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";

  const result = await verifyWebAuthnRegistration(c.req.raw, body.response, body.deviceLabel);
  if (!result.verified) {
    await recordAudit({
      method: "passkey_register",
      success: false,
      ip,
      userAgent,
      failureReason: result.error || "Registration failed",
    });
    return c.json({ error: result.error || "Passkey registration failed." }, 400);
  }

  await recordAudit({ method: "passkey_register", success: true, ip, userAgent });
  return c.json({ ok: true, credentialId: result.credentialId });
});

authRouter.get("/webauthn/credentials", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const credentials = await listWebAuthnCredentials();
  return c.json({ credentials });
});

authRouter.delete("/webauthn/credentials/:id", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const session = await verifySession(cookieValue);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number.parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) {
    return c.json({ error: "Invalid credential id." }, 400);
  }

  const success = await deleteWebAuthnCredential(id);
  return c.json({ ok: success });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Tiered Trust & Step-Up Elevation (Phase 6)
// ─────────────────────────────────────────────────────────────────────────────

authRouter.post("/elevate", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";
  const session = await verifySession(cookieValue, ip);

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // If already elevated, return current scope
  if (session.scope === "forge_unlocked") {
    return c.json({ ok: true, scope: "forge_unlocked", message: "Already elevated." });
  }

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return c.json(
      { error: `Too many attempts. Please wait ${rateLimit.retryAfterSeconds ?? 900} seconds.` },
      429
    );
  }

  if (rateLimit.delayMs) {
    await new Promise((resolve) => setTimeout(resolve, rateLimit.delayMs));
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: "Elevation credentials required." }, 400);
  }

  let verified = false;
  let methodUsed = "unknown";

  // Method 1: Master Password
  if (body.password) {
    methodUsed = "password";
    verified = await verifyMasterPassword(body.password);
  }
  // Method 2: TOTP Code
  else if (body.code) {
    methodUsed = "totp";
    const totpResult = await verifyTotpLogin(body.code);
    verified = totpResult.valid;
  }
  // Method 3: WebAuthn Passkey Assertion
  else if (body.assertion) {
    methodUsed = "passkey";
    const passkeyResult = await verifyWebAuthnLogin(c.req.raw, body.assertion);
    verified = passkeyResult.verified;
  } else {
    return c.json(
      { error: "Provide master password, TOTP code, or passkey assertion to elevate." },
      400
    );
  }

  if (!verified) {
    recordRateLimitFailure(ip);
    await recordAudit({
      method: `elevate_${methodUsed}`,
      success: false,
      ip,
      userAgent,
      failureReason: "Invalid elevation credential",
    });
    return c.json({ error: "Elevation verification failed." }, 401);
  }

  clearRateLimit(ip);
  await elevateSession(session.id);
  await recordAudit({
    method: `elevate_${methodUsed}`,
    success: true,
    ip,
    userAgent,
  });

  return c.json({ ok: true, scope: "forge_unlocked" });
});

authRouter.post("/demote", async (c) => {
  const cookieValue = parseCookie(c, SESSION_COOKIE_NAME);
  const ip = getClientIp(c);
  const userAgent = c.req.header("user-agent") || "";
  const session = await verifySession(cookieValue, ip);

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await demoteSession(session.id);
  await recordAudit({
    method: "demote",
    success: true,
    ip,
    userAgent,
  });

  return c.json({ ok: true, scope: "standard" });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Cloudflare Access Outer Perimeter (Phase 7)
// ─────────────────────────────────────────────────────────────────────────────

authRouter.get("/cloudflare/status", async (c) => {
  const config = getCloudflareAccessConfig();
  const token = extractCloudflareToken(c.req.raw);
  return c.json({
    configured: Boolean(config.teamDomain),
    required: config.required,
    teamDomain: config.teamDomain,
    hasAud: Boolean(config.expectedAud),
    tokenPresent: Boolean(token),
  });
});




