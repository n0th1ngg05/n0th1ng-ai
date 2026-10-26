import * as crypto from "crypto";
import * as argon2 from "argon2";
import { eq, and, isNull, gt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { env } from "../lib/env";
import {
  authCredentials,
  sessions,
  authAuditLog,
  workerApiKeys,
} from "../../db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Argon2id Configuration (Tuned with environment override capability)
// ─────────────────────────────────────────────────────────────────────────────
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_COST) || 65536, // 64 MB default
  timeCost: Number(process.env.ARGON2_TIME_COST) || 3,
  parallelism: Number(process.env.ARGON2_PARALLELISM) || 1,
};

export const SESSION_COOKIE_NAME = "n0th1ng_session";
export const DEVICE_TRUST_COOKIE_NAME = "n0th1ng_device_trust";

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Rate Limiter for /api/auth/*
// ─────────────────────────────────────────────────────────────────────────────
interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lockedUntil: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

// Cleanup stale rate limit entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitStore.forEach((entry, ip) => {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS && now > entry.lockedUntil) {
      rateLimitStore.delete(ip);
    }
  });
}, 15 * 60 * 1000);

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number; delayMs?: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry) {
    return { allowed: true };
  }

  if (entry.lockedUntil > now) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter };
  }

  // If window expired, reset
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.delete(ip);
    return { allowed: true };
  }

  // Progressive delay for attempts 3 and 4
  if (entry.attempts >= 3 && entry.attempts < MAX_ATTEMPTS) {
    return { allowed: true, delayMs: 2500 };
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    return { allowed: false, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) };
  }

  return { allowed: true };
}

export function recordRateLimitFailure(ip: string) {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);
  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { attempts: 1, firstAttempt: now, lockedUntil: 0 });
  } else {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_MS;
    }
  }
}

export function clearRateLimit(ip: string) {
  rateLimitStore.delete(ip);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Logging
// ─────────────────────────────────────────────────────────────────────────────
export async function recordAudit(params: {
  method: string;
  success: boolean;
  ip?: string;
  userAgent?: string;
  failureReason?: string;
}) {
  try {
    const db = getDb();
    await db.insert(authAuditLog).values({
      method: params.method,
      success: params.success,
      ip: params.ip ? params.ip.slice(0, 64) : null,
      userAgent: params.userAgent ? params.userAgent.slice(0, 500) : null,
      failureReason: params.failureReason ? params.failureReason.slice(0, 255) : null,
    });
  } catch (err) {
    console.error("[Auth Audit] Failed to record audit log:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Password Management (Argon2id)
// ─────────────────────────────────────────────────────────────────────────────
export async function hasMasterPassword(): Promise<boolean> {
  const db = getDb();
  const [creds] = await db.select().from(authCredentials).limit(1);
  return Boolean(creds && creds.passwordHash);
}

export async function setMasterPassword(plainPassword: string): Promise<void> {
  if (!plainPassword || plainPassword.length < 8) {
    throw new Error("Master password must be at least 8 characters long.");
  }
  const passwordHash = await argon2.hash(plainPassword, ARGON2_OPTIONS);
  const db = getDb();
  const [existing] = await db.select().from(authCredentials).limit(1);

  if (existing) {
    await db
      .update(authCredentials)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(authCredentials.id, existing.id));
  } else {
    await db.insert(authCredentials).values({ passwordHash });
  }

  // Revoke all existing sessions when password changes
  await revokeAllSessions();
}

export async function verifyMasterPassword(plainPassword: string): Promise<boolean> {
  const db = getDb();
  const [creds] = await db.select().from(authCredentials).limit(1);
  if (!creds || !creds.passwordHash) {
    return false;
  }
  return await argon2.verify(creds.passwordHash, plainPassword);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Management (Opaque Random Tokens with HMAC signature verification)
// ─────────────────────────────────────────────────────────────────────────────
function signSessionId(sessionId: string): string {
  const hmac = crypto.createHmac("sha256", env.appSecret);
  hmac.update(sessionId);
  const signature = hmac.digest("base64url");
  return `${sessionId}.${signature}`;
}

export function parseAndVerifySignedCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) return null;

  const sessionId = cookieValue.slice(0, dotIndex);
  const providedSignature = cookieValue.slice(dotIndex + 1);

  const hmac = crypto.createHmac("sha256", env.appSecret);
  hmac.update(sessionId);
  const expectedSignature = hmac.digest("base64url");

  // Constant-time signature verification
  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  return sessionId;
}

export async function createSession(params: {
  methodUsed: "password" | "totp" | "pin" | "passkey";
  deviceLabel?: string;
  ip?: string;
  rememberMe?: boolean;
  scope?: "standard" | "forge_unlocked";
}): Promise<{ sessionId: string; cookieValue: string; expiresAt: Date }> {
  const db = getDb();
  const sessionId = crypto.randomBytes(32).toString("hex"); // 64 char opaque random token
  const durationMs = params.rememberMe !== false 
    ? 30 * 24 * 60 * 60 * 1000 // 30 days
    : 24 * 60 * 60 * 1000;      // 24 hours
  const expiresAt = new Date(Date.now() + durationMs);

  await db.insert(sessions).values({
    id: sessionId,
    deviceLabel: params.deviceLabel ? params.deviceLabel.slice(0, 255) : null,
    methodUsed: params.methodUsed,
    scope: params.scope || "standard",
    ipLastSeen: params.ip ? params.ip.slice(0, 64) : null,
    expiresAt,
  });

  const cookieValue = signSessionId(sessionId);
  return { sessionId, cookieValue, expiresAt };
}

export async function verifySession(cookieValue: string | undefined, clientIp?: string) {
  const sessionId = parseAndVerifySignedCookie(cookieValue);
  if (!sessionId) return null;

  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!session) return null;

  // Throttled update of lastSeenAt (only update if > 60 seconds since last check)
  const now = Date.now();
  if (now - new Date(session.lastSeenAt).getTime() > 60 * 1000) {
    db.update(sessions)
      .set({
        lastSeenAt: new Date(),
        ipLastSeen: clientIp ? clientIp.slice(0, 64) : session.ipLastSeen,
      })
      .where(eq(sessions.id, sessionId))
      .catch((e) => console.error("[Auth] Session lastSeen update failed:", e));
  }

  return session;
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(): Promise<void> {
  const db = getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(isNull(sessions.revokedAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker Lane Authentication (Bearer Key / X-Workstation-Key)
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyWorkerKey(incomingKey: string | undefined): Promise<boolean> {
  if (!incomingKey || typeof incomingKey !== "string") return false;

  // 1. Check against environment fallback (e.g. WORKER_DESKTOP_KEY)
  const envKey = process.env.WORKER_DESKTOP_KEY;
  if (envKey) {
    const incBuf = Buffer.from(incomingKey);
    const envBuf = Buffer.from(envKey);
    if (incBuf.length === envBuf.length && crypto.timingSafeEqual(incBuf, envBuf)) {
      return true;
    }
  }

  // 2. Check against worker_api_keys table
  try {
    const db = getDb();
    const activeKeys = await db
      .select()
      .from(workerApiKeys)
      .where(isNull(workerApiKeys.revokedAt));

    // Hash incoming key with sha256 to compare against keyHash
    const incomingHash = crypto.createHash("sha256").update(incomingKey).digest("hex");
    const incomingHashBuf = Buffer.from(incomingHash);

    for (const k of activeKeys) {
      const storedHashBuf = Buffer.from(k.keyHash);
      if (
        storedHashBuf.length === incomingHashBuf.length &&
        crypto.timingSafeEqual(storedHashBuf, incomingHashBuf)
      ) {
        // Record lastUsedAt asynchronously
        db.update(workerApiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(workerApiKeys.id, k.id))
          .catch(() => {});
        return true;
      }
    }
  } catch (err) {
    console.error("[Auth] Error verifying worker API key:", err);
  }

  return false;
}

export async function createWorkerApiKey(label: string): Promise<{ id: number; label: string; plaintextKey: string; keyHash: string }> {
  if (!label || label.trim().length === 0) {
    throw new Error("Worker label is required.");
  }
  const db = getDb();
  const plaintextKey = `n0th1ng_wk_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(plaintextKey).digest("hex");

  const [result] = await db.insert(workerApiKeys).values({
    label: label.trim(),
    keyHash,
  });

  return { id: (result as any).insertId, label: label.trim(), plaintextKey, keyHash };
}

export async function listWorkerApiKeys() {
  const db = getDb();
  return await db.select().from(workerApiKeys);
}

export async function revokeWorkerApiKey(id: number): Promise<boolean> {
  const db = getDb();
  const [key] = await db.select().from(workerApiKeys).where(eq(workerApiKeys.id, id)).limit(1);
  if (!key) return false;

  await db
    .update(workerApiKeys)
    .set({ revokedAt: new Date() })
    .where(eq(workerApiKeys.id, id));
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Protocol / HTTPS helper (Never hardcode isProd)
// ─────────────────────────────────────────────────────────────────────────────

export function isRequestSecure(req: Request): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.toLowerCase() === "https";
  }
  return req.url.startsWith("https://");
}
