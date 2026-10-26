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
  authTotpSecrets,
  deviceTrust,
  authWebauthnCredentials,
} from "../../db/schema";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";


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

  // Phase 6: Check 30-minute idle auto-demotion for forge_unlocked scope
  const now = Date.now();
  const FORGE_UNLOCKED_MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes
  if (session.scope === "forge_unlocked" && now - new Date(session.lastSeenAt).getTime() > FORGE_UNLOCKED_MAX_IDLE_MS) {
    session.scope = "standard";
    db.update(sessions)
      .set({ scope: "standard" })
      .where(eq(sessions.id, sessionId))
      .catch((e) => console.error("[Auth] Session auto-demote to standard failed:", e));
  }

  // Throttled update of lastSeenAt (only update if > 60 seconds since last check)
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

export async function elevateSession(sessionId: string): Promise<boolean> {
  const db = getDb();
  const [result] = await db
    .update(sessions)
    .set({
      scope: "forge_unlocked",
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    );
  return (result as any)?.affectedRows > 0;
}

export async function demoteSession(sessionId: string): Promise<boolean> {
  const db = getDb();
  const [result] = await db
    .update(sessions)
    .set({
      scope: "standard",
      lastSeenAt: new Date(),
    })
    .where(
      and(
        eq(sessions.id, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    );
  return (result as any)?.affectedRows > 0;
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

// ─────────────────────────────────────────────────────────────────────────────
// TOTP Secret Encryption at Rest (AES-256-GCM via APP_SECRET)
// ─────────────────────────────────────────────────────────────────────────────
function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(env.appSecret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12); // 96-bit IV
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}.${authTag}.${enc}`;
}

export function decryptSecret(encryptedBlob: string): string {
  const [ivHex, authTagHex, encHex] = encryptedBlob.split(".");
  if (!ivHex || !authTagHex || !encHex) {
    throw new Error("Invalid encrypted secret format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let dec = decipher.update(encHex, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending TOTP Login Tokens (Password verified, awaiting second factor)
// ─────────────────────────────────────────────────────────────────────────────
export interface PendingTotpToken {
  createdAt: number;
  ip: string;
  rememberMe: boolean;
  deviceLabel?: string;
  attempts: number;
  trustDevice?: boolean;
  pin?: string;
}

const pendingTotpStore = new Map<string, PendingTotpToken>();
const PENDING_TOTP_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes hard expiry

// Periodically clean up expired pending tokens
setInterval(() => {
  const now = Date.now();
  pendingTotpStore.forEach((data, token) => {
    if (now - data.createdAt > PENDING_TOTP_LIFETIME_MS) {
      pendingTotpStore.delete(token);
    }
  });
}, 60 * 1000);

export function createPendingTotpToken(params: {
  ip: string;
  rememberMe: boolean;
  deviceLabel?: string;
  trustDevice?: boolean;
  pin?: string;
}): string {
  const token = crypto.randomBytes(32).toString("hex");
  pendingTotpStore.set(token, {
    createdAt: Date.now(),
    ip: params.ip,
    rememberMe: params.rememberMe,
    deviceLabel: params.deviceLabel,
    attempts: 0,
    trustDevice: params.trustDevice,
    pin: params.pin,
  });
  return token;
}

export function getPendingTotpToken(token: string): PendingTotpToken | null {
  if (!token || typeof token !== "string") return null;
  const data = pendingTotpStore.get(token);
  if (!data) return null;
  if (Date.now() - data.createdAt > PENDING_TOTP_LIFETIME_MS) {
    pendingTotpStore.delete(token);
    return null;
  }
  return data;
}

export function deletePendingTotpToken(token: string): void {
  pendingTotpStore.delete(token);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTP Clock Drift & Replay Protection Verification
// ─────────────────────────────────────────────────────────────────────────────
export interface TotpVerifyResult {
  valid: boolean;
  reason?: "invalid_code" | "code_already_used" | "no_secret";
  step?: number;
}

export function verifyTotpCode(
  plainBase32Secret: string,
  code: string,
  lastVerifiedStep: number | null | undefined
): TotpVerifyResult {
  const cleanCode = code.replace(/\s+/g, "");
  const currentStep = Math.floor(Date.now() / 1000 / 30);

  // window: 1 means step - 1, step, step + 1 (90s tolerance total)
  const verifyResult = speakeasy.totp.verifyDelta({
    secret: plainBase32Secret,
    encoding: "base32",
    token: cleanCode,
    window: 1,
  });

  if (!verifyResult) {
    return { valid: false, reason: "invalid_code" };
  }

  const matchedStep = currentStep + verifyResult.delta;

  // Replay protection: If this step (or newer) was already consumed, reject!
  if (lastVerifiedStep != null && matchedStep <= lastVerifiedStep) {
    return { valid: false, reason: "code_already_used" };
  }

  return { valid: true, step: matchedStep };
}

export async function hasTotpEnabled(): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(authTotpSecrets)
    .where(eq(authTotpSecrets.verified, true))
    .limit(1);
  return Boolean(row);
}

export async function enrollTotp(): Promise<{ secret: string; uri: string; qrCode: string }> {
  const db = getDb();
  const secretObj = speakeasy.generateSecret({
    length: 20,
    name: "n0th1ng AI (Operator)",
    issuer: "n0th1ng AI",
  });

  const encryptedSecret = encryptSecret(secretObj.base32);

  // Clean up any unverified attempt
  await db.delete(authTotpSecrets).where(eq(authTotpSecrets.verified, false));

  // Insert new pending enrollment row
  await db.insert(authTotpSecrets).values({
    secret: encryptedSecret,
    verified: false,
  });

  const uri = secretObj.otpauth_url || "";
  const qrCode = await QRCode.toDataURL(uri);

  return {
    secret: secretObj.base32,
    uri,
    qrCode,
  };
}

export async function confirmTotpEnrollment(code: string): Promise<{ success: boolean; error?: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(authTotpSecrets)
    .where(eq(authTotpSecrets.verified, false))
    .limit(1);

  if (!row) {
    return { success: false, error: "No pending TOTP enrollment found." };
  }

  let plainSecret = "";
  try {
    plainSecret = decryptSecret(row.secret);
  } catch (err) {
    return { success: false, error: "Failed to decrypt secret." };
  }

  const result = verifyTotpCode(plainSecret, code, null);
  if (!result.valid || result.step == null) {
    return { success: false, error: "Invalid authenticator code." };
  }

  // Remove any previously verified secret
  await db.delete(authTotpSecrets).where(eq(authTotpSecrets.verified, true));

  // Mark newly confirmed secret as verified
  await db
    .update(authTotpSecrets)
    .set({
      verified: true,
      lastVerifiedStep: result.step,
    })
    .where(eq(authTotpSecrets.id, row.id));

  return { success: true };
}

export async function verifyTotpLogin(code: string): Promise<TotpVerifyResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(authTotpSecrets)
    .where(eq(authTotpSecrets.verified, true))
    .limit(1);

  if (!row) {
    return { valid: false, reason: "no_secret" };
  }

  let plainSecret = "";
  try {
    plainSecret = decryptSecret(row.secret);
  } catch (err) {
    return { valid: false, reason: "invalid_code" };
  }

  const result = verifyTotpCode(plainSecret, code, row.lastVerifiedStep);
  if (result.valid && result.step != null) {
    await db
      .update(authTotpSecrets)
      .set({ lastVerifiedStep: result.step })
      .where(eq(authTotpSecrets.id, row.id));
  }

  return result;
}

export async function disableTotp(): Promise<void> {
  const db = getDb();
  await db.delete(authTotpSecrets);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Device Trust & Quick PIN Unlock
// ─────────────────────────────────────────────────────────────────────────────

export const DEVICE_TRUST_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days default

export function signDeviceTrustToken(rawToken: string): string {
  const hmac = crypto.createHmac("sha256", env.appSecret);
  hmac.update(rawToken);
  const signature = hmac.digest("hex");
  return `${rawToken}.${signature}`;
}

export function parseDeviceTrustToken(cookieValue: string | undefined): string | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dotIndex = cookieValue.indexOf(".");
  if (dotIndex === -1) return null;

  const rawToken = cookieValue.slice(0, dotIndex);
  const signature = cookieValue.slice(dotIndex + 1);

  if (!rawToken || !signature) return null;

  const hmac = crypto.createHmac("sha256", env.appSecret);
  hmac.update(rawToken);
  const expectedSignature = hmac.digest("hex");

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  return rawToken;
}

export async function createDeviceTrust(params: {
  pin?: string;
  deviceFingerprint?: string;
  maxAgeDays?: number;
}): Promise<{ cookieValue: string; expiresAt: Date; rawToken: string }> {
  let pinHash: string | null = null;
  if (params.pin) {
    const cleanPin = params.pin.trim();
    if (!/^\d{4,8}$/.test(cleanPin)) {
      throw new Error("PIN must be between 4 and 8 digits.");
    }
    pinHash = await argon2.hash(cleanPin, ARGON2_OPTIONS);
  }

  const db = getDb();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const cookieValue = signDeviceTrustToken(rawToken);

  const days = params.maxAgeDays && params.maxAgeDays > 0 ? params.maxAgeDays : 30;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await db.insert(deviceTrust).values({
    token: rawToken,
    deviceFingerprint: params.deviceFingerprint || null,
    pinHash,
    expiresAt,
  });

  return { cookieValue, expiresAt, rawToken };
}

export async function getDeviceTrust(cookieValue: string | undefined) {
  const rawToken = parseDeviceTrustToken(cookieValue);
  if (!rawToken) return null;

  const db = getDb();
  const [device] = await db
    .select()
    .from(deviceTrust)
    .where(and(eq(deviceTrust.token, rawToken), gt(deviceTrust.expiresAt, new Date())))
    .limit(1);

  return device || null;
}

export interface VerifyDevicePinResult {
  valid: boolean;
  reason?: "not_trusted" | "no_pin" | "invalid_pin";
  device?: any;
}

export async function verifyDevicePin(
  cookieValue: string | undefined,
  pin: string
): Promise<VerifyDevicePinResult> {
  const device = await getDeviceTrust(cookieValue);
  if (!device) {
    return { valid: false, reason: "not_trusted" };
  }

  if (!device.pinHash) {
    return { valid: false, reason: "no_pin" };
  }

  const cleanPin = (pin || "").trim();
  if (!cleanPin) {
    return { valid: false, reason: "invalid_pin" };
  }

  try {
    const isValid = await argon2.verify(device.pinHash, cleanPin);
    if (!isValid) {
      return { valid: false, reason: "invalid_pin" };
    }
    return { valid: true, device };
  } catch (err) {
    console.error("[Auth] Error verifying PIN hash:", err);
    return { valid: false, reason: "invalid_pin" };
  }
}

export async function setDevicePin(
  cookieValue: string | undefined,
  pin: string
): Promise<boolean> {
  const rawToken = parseDeviceTrustToken(cookieValue);
  if (!rawToken) return false;

  const cleanPin = pin.trim();
  if (!/^\d{4,8}$/.test(cleanPin)) {
    throw new Error("PIN must be between 4 and 8 digits.");
  }

  const pinHash = await argon2.hash(cleanPin, ARGON2_OPTIONS);
  const db = getDb();

  const [result] = await db
    .update(deviceTrust)
    .set({ pinHash })
    .where(and(eq(deviceTrust.token, rawToken), gt(deviceTrust.expiresAt, new Date())));

  return (result as any)?.affectedRows > 0;
}

export async function revokeDeviceTrust(cookieValue: string | undefined): Promise<boolean> {
  const rawToken = parseDeviceTrustToken(cookieValue);
  if (!rawToken) return false;

  const db = getDb();
  await db.delete(deviceTrust).where(eq(deviceTrust.token, rawToken));
  return true;
}

export async function revokeAllDeviceTrust(): Promise<void> {
  const db = getDb();
  await db.delete(deviceTrust);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: WebAuthn / Passkeys (Windows Hello, Touch ID, YubiKey)
// ─────────────────────────────────────────────────────────────────────────────

export function getWebAuthnConfig(req: Request) {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const hostHeader = forwardedHost || req.headers.get("host") || url.host;
  const hostname = hostHeader.split(":")[0];

  // RP ID must be domain/hostname (environment override if set, else request hostname)
  const rpID = process.env.WEBAUTHN_RP_ID || hostname;
  const rpName = process.env.WEBAUTHN_RP_NAME || "n0th1ng AI";

  const isSecure = isRequestSecure(req);
  const protocol = isSecure ? "https" : "http";
  const defaultOrigin = `${protocol}://${hostHeader}`;
  const origin = process.env.WEBAUTHN_ORIGIN || defaultOrigin;

  // Expected origins: allow both exact origin, defaultOrigin, and common dev/proxy variants
  const expectedOrigins = Array.from(
    new Set([
      origin,
      defaultOrigin,
      `http://localhost:3000`,
      `http://127.0.0.1:3000`,
      `https://${hostname}`,
      `http://${hostname}`,
    ])
  );

  return { rpID, rpName, origin, expectedOrigins };
}

interface WebAuthnChallengeEntry {
  challenge: string;
  createdAt: number;
  type: "registration" | "authentication";
}

const webAuthnChallengeStore = new Map<string, WebAuthnChallengeEntry>();
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes hard expiry

setInterval(() => {
  const now = Date.now();
  webAuthnChallengeStore.forEach((entry, key) => {
    if (now - entry.createdAt > WEBAUTHN_CHALLENGE_TTL_MS) {
      webAuthnChallengeStore.delete(key);
    }
  });
}, 60 * 1000);

export function saveWebAuthnChallenge(challenge: string, type: "registration" | "authentication"): void {
  webAuthnChallengeStore.set(challenge, {
    challenge,
    createdAt: Date.now(),
    type,
  });
}

export function consumeWebAuthnChallenge(challenge: string, expectedType: "registration" | "authentication"): boolean {
  if (!challenge) return false;
  const entry = webAuthnChallengeStore.get(challenge);
  if (!entry) return false;
  if (entry.type !== expectedType) return false;
  webAuthnChallengeStore.delete(challenge);
  if (Date.now() - entry.createdAt > WEBAUTHN_CHALLENGE_TTL_MS) return false;
  return true;
}

export async function hasWebAuthnCredentials(): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select().from(authWebauthnCredentials).limit(1);
  return Boolean(row);
}

export async function listWebAuthnCredentials() {
  const db = getDb();
  return await db.select({
    id: authWebauthnCredentials.id,
    credentialId: authWebauthnCredentials.credentialId,
    deviceLabel: authWebauthnCredentials.deviceLabel,
    createdAt: authWebauthnCredentials.createdAt,
    lastUsedAt: authWebauthnCredentials.lastUsedAt,
  }).from(authWebauthnCredentials);
}

export async function deleteWebAuthnCredential(id: number): Promise<boolean> {
  const db = getDb();
  const [result] = await db.delete(authWebauthnCredentials).where(eq(authWebauthnCredentials.id, id));
  return (result as any)?.affectedRows > 0;
}

export async function getWebAuthnRegistrationOptions(req: Request) {
  const config = getWebAuthnConfig(req);
  const db = getDb();
  const existingCredentials = await db.select().from(authWebauthnCredentials);

  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpID,
    userName: "Operator",
    userDisplayName: "n0th1ng AI Operator",
    userID: new Uint8Array([110, 48, 116, 104, 49, 110, 103]), // 'n0th1ng'
    attestationType: "none",
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.credentialId,
      transports: (c.transports as any) || undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  saveWebAuthnChallenge(options.challenge, "registration");
  return options;
}

export async function verifyWebAuthnRegistration(
  req: Request,
  body: RegistrationResponseJSON,
  deviceLabel?: string
): Promise<{ verified: boolean; error?: string; credentialId?: string }> {
  const config = getWebAuthnConfig(req);

  let challenge = "";
  try {
    const clientDataJSON = JSON.parse(Buffer.from(body.response.clientDataJSON, "base64url").toString("utf8"));
    challenge = clientDataJSON.challenge;
  } catch (err) {
    return { verified: false, error: "Failed to parse client data JSON." };
  }

  if (!consumeWebAuthnChallenge(challenge, "registration")) {
    return { verified: false, error: "Registration challenge expired or invalid." };
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { verified: false, error: "Passkey registration verification failed." };
    }

    const { credential } = verification.registrationInfo;
    const db = getDb();

    const publicKeyBase64 = Buffer.from(credential.publicKey).toString("base64url");

    await db.insert(authWebauthnCredentials).values({
      credentialId: credential.id,
      publicKey: publicKeyBase64,
      counter: credential.counter,
      deviceLabel: deviceLabel || "Passkey",
      transports: credential.transports || [],
    });

    return { verified: true, credentialId: credential.id };
  } catch (err: any) {
    console.error("[WebAuthn] Registration error:", err);
    return { verified: false, error: err.message || "Registration verification failed." };
  }
}

export async function getWebAuthnLoginOptions(req: Request) {
  const config = getWebAuthnConfig(req);
  const db = getDb();
  const credentials = await db.select().from(authWebauthnCredentials);

  if (credentials.length === 0) {
    return { available: false, options: null };
  }

  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: (c.transports as any) || undefined,
    })),
    userVerification: "preferred",
  });

  saveWebAuthnChallenge(options.challenge, "authentication");
  return { available: true, options };
}

export async function verifyWebAuthnLogin(
  req: Request,
  body: AuthenticationResponseJSON
): Promise<{ verified: boolean; error?: string; credential?: any }> {
  const config = getWebAuthnConfig(req);

  let challenge = "";
  try {
    const clientDataJSON = JSON.parse(Buffer.from(body.response.clientDataJSON, "base64url").toString("utf8"));
    challenge = clientDataJSON.challenge;
  } catch (err) {
    return { verified: false, error: "Failed to parse client data JSON." };
  }

  if (!consumeWebAuthnChallenge(challenge, "authentication")) {
    return { verified: false, error: "Authentication challenge expired or invalid." };
  }

  const db = getDb();
  const [credRecord] = await db
    .select()
    .from(authWebauthnCredentials)
    .where(eq(authWebauthnCredentials.credentialId, body.id))
    .limit(1);

  if (!credRecord) {
    return { verified: false, error: "Passkey credential not recognized." };
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: config.expectedOrigins,
      expectedRPID: config.rpID,
      credential: {
        id: credRecord.credentialId,
        publicKey: new Uint8Array(Buffer.from(credRecord.publicKey, "base64url")),
        counter: credRecord.counter,
        transports: (credRecord.transports as any) || undefined,
      },
    });

    if (!verification.verified || !verification.authenticationInfo) {
      return { verified: false, error: "Passkey authentication failed." };
    }

    // Update counter and lastUsedAt
    await db
      .update(authWebauthnCredentials)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(authWebauthnCredentials.id, credRecord.id));

    return { verified: true, credential: credRecord };
  } catch (err: any) {
    console.error("[WebAuthn] Authentication error:", err);
    return { verified: false, error: err.message || "Passkey authentication failed." };
  }
}



