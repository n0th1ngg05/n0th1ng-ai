import crypto from "crypto";

export interface CloudflareAccessPayload {
  aud: string | string[];
  email?: string;
  exp: number;
  iat: number;
  nbf: number;
  iss: string;
  type: string;
  identity_type?: string;
  sub: string;
  country?: string;
  [key: string]: any;
}

export interface CloudflareAccessVerifyResult {
  valid: boolean;
  reason?: string;
  payload?: CloudflareAccessPayload;
}

export interface CloudflareAccessConfig {
  teamDomain: string | null;
  expectedAud: string | null;
  required: boolean;
  serviceClientId: string | null;
  serviceClientSecret: string | null;
}

// In-memory cache for Cloudflare Access public keys
interface CachedKeys {
  keysByKid: Map<string, any>;
  expiresAt: number;
}

let cachedKeys: CachedKeys | null = null;
const CERTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
let lastFetchAttempt = 0;
const MIN_FETCH_INTERVAL_MS = 5000; // Rate limit key fetching
let isPinnedKeys = false;

/**
 * Normalizes team domain into a full https://<team>.cloudflareaccess.com URL
 */
export function normalizeTeamDomain(input: string | undefined): string | null {
  if (!input || typeof input !== "string") return null;
  let clean = input.trim().toLowerCase();
  if (!clean) return null;

  if (clean.startsWith("https://")) {
    clean = clean.slice(8);
  } else if (clean.startsWith("http://")) {
    clean = clean.slice(7);
  }

  // Remove trailing slashes and paths
  clean = clean.split("/")[0];

  if (!clean.includes(".cloudflareaccess.com")) {
    clean = `${clean}.cloudflareaccess.com`;
  }

  return `https://${clean}`;
}

export function getCloudflareAccessConfig(): CloudflareAccessConfig {
  const teamDomainRaw = process.env.CF_ACCESS_TEAM_DOMAIN || process.env.CF_ACCESS_TEAM_NAME;
  const teamDomain = normalizeTeamDomain(teamDomainRaw);
  const expectedAud = process.env.CF_ACCESS_AUD ? process.env.CF_ACCESS_AUD.trim() : null;
  const required =
    process.env.CF_ACCESS_REQUIRED === "true" || process.env.CF_ACCESS_ENFORCED === "true";
  const serviceClientId = process.env.CF_ACCESS_SERVICE_CLIENT_ID
    ? process.env.CF_ACCESS_SERVICE_CLIENT_ID.trim()
    : null;
  const serviceClientSecret = process.env.CF_ACCESS_SERVICE_CLIENT_SECRET
    ? process.env.CF_ACCESS_SERVICE_CLIENT_SECRET.trim()
    : null;

  return {
    teamDomain,
    expectedAud,
    required,
    serviceClientId,
    serviceClientSecret,
  };
}

/**
 * Fetches and caches the JWKs from Cloudflare Access certs endpoint
 */
export async function getCloudflarePublicKeys(
  teamDomain: string,
  forceRefresh = false
): Promise<Map<string, any>> {
  if (isPinnedKeys && cachedKeys) {
    return cachedKeys.keysByKid;
  }

  const now = Date.now();
  if (
    !forceRefresh &&
    cachedKeys &&
    now < cachedKeys.expiresAt &&
    cachedKeys.keysByKid.size > 0
  ) {
    return cachedKeys.keysByKid;
  }

  // Rate limit outbound fetch attempts
  if (now - lastFetchAttempt < MIN_FETCH_INTERVAL_MS && cachedKeys) {
    return cachedKeys.keysByKid;
  }
  lastFetchAttempt = now;

  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  try {
    const res = await fetch(certsUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.error(`[Cloudflare Access] Failed to fetch certs from ${certsUrl}: HTTP ${res.status}`);
      return cachedKeys ? cachedKeys.keysByKid : new Map();
    }

    const data = await res.json();
    const keys = Array.isArray(data?.keys) ? data.keys : [];
    const newMap = new Map<string, any>();

    for (const key of keys) {
      if (key && key.kid) {
        newMap.set(key.kid, key);
      }
    }

    cachedKeys = {
      keysByKid: newMap,
      expiresAt: now + CERTS_CACHE_TTL_MS,
    };

    return newMap;
  } catch (err) {
    console.error(`[Cloudflare Access] Error fetching certs from ${certsUrl}:`, err);
    return cachedKeys ? cachedKeys.keysByKid : new Map();
  }
}

/**
 * Set custom JWKs (primarily for unit tests or offline verification)
 */
export function setCachedCloudflareKeys(keys: any[]): void {
  const newMap = new Map<string, any>();
  for (const k of keys) {
    if (k && k.kid) newMap.set(k.kid, k);
  }
  cachedKeys = {
    keysByKid: newMap,
    expiresAt: Date.now() + CERTS_CACHE_TTL_MS,
  };
  isPinnedKeys = true;
}

export function clearCloudflareKeysCache(): void {
  cachedKeys = null;
  isPinnedKeys = false;
}

/**
 * Verifies an RS256 Cloudflare Access JWT Assertion
 */
export async function verifyCloudflareJwt(
  token: string,
  options?: {
    teamDomain?: string | null;
    expectedAud?: string | null;
    customKeys?: Map<string, any>;
  }
): Promise<CloudflareAccessVerifyResult> {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "missing_token" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed_jwt" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: CloudflareAccessPayload;

  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch (err) {
    return { valid: false, reason: "invalid_json_encoding" };
  }

  // Cloudflare Access always signs with RS256
  if (header.alg !== "RS256") {
    return { valid: false, reason: "unsupported_algorithm" };
  }

  if (!header.kid) {
    return { valid: false, reason: "missing_kid" };
  }

  // Validate timestamps
  const nowSec = Math.floor(Date.now() / 1000);
  const CLOCK_SKEW_SEC = 60; // 60s tolerance

  if (typeof payload.exp !== "number" || payload.exp < nowSec - CLOCK_SKEW_SEC) {
    return { valid: false, reason: "token_expired" };
  }

  if (typeof payload.nbf === "number" && payload.nbf > nowSec + CLOCK_SKEW_SEC) {
    return { valid: false, reason: "token_not_yet_valid" };
  }

  // Validate AUD if configured
  const expectedAud = options?.expectedAud;
  if (expectedAud) {
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(expectedAud)) {
      return { valid: false, reason: "audience_mismatch" };
    }
  }

  // Validate ISS if teamDomain is configured
  const teamDomain = options?.teamDomain;
  if (teamDomain && payload.iss) {
    const cleanIss = payload.iss.replace(/\/+$/, "");
    const cleanTeam = teamDomain.replace(/\/+$/, "");
    if (cleanIss !== cleanTeam) {
      return { valid: false, reason: "issuer_mismatch" };
    }
  }

  // Lookup public key
  let keysMap = options?.customKeys;
  if (!keysMap) {
    if (!teamDomain) {
      // If teamDomain is not configured and no customKeys, cannot fetch certs
      return { valid: false, reason: "unconfigured_team_domain" };
    }
    keysMap = await getCloudflarePublicKeys(teamDomain);
    // If not found in cache, force refresh once
    if (!keysMap.has(header.kid)) {
      keysMap = await getCloudflarePublicKeys(teamDomain, true);
    }
  }

  const jwk = keysMap.get(header.kid);
  if (!jwk) {
    return { valid: false, reason: "unknown_signing_key" };
  }

  // Verify RS256 signature using Node native crypto
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, "base64url");

    const isVerified = crypto.verify("RSA-SHA256", signingInput, publicKey, signature);
    if (!isVerified) {
      return { valid: false, reason: "invalid_signature" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    console.error("[Cloudflare Access] Signature verification exception:", err);
    return { valid: false, reason: "verification_error" };
  }
}

/**
 * Extracts Cloudflare Access token from request headers or cookie
 */
export function extractCloudflareToken(req: Request): string | null {
  // 1. Header: Cf-Access-Jwt-Assertion
  const headerToken = req.headers.get("cf-access-jwt-assertion");
  if (headerToken && headerToken.trim()) {
    return headerToken.trim();
  }

  // 2. Cookie: CF_Authorization
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)CF_Authorization=([^;]*)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]).trim();
    }
  }

  return null;
}

/**
 * Checks for Cloudflare Access Service Token headers (CF-Access-Client-Id / CF-Access-Client-Secret)
 */
export function verifyCloudflareServiceTokenHeaders(req: Request, config: CloudflareAccessConfig): boolean {
  if (!config.serviceClientId || !config.serviceClientSecret) {
    return false;
  }

  const clientId = req.headers.get("cf-access-client-id");
  const clientSecret = req.headers.get("cf-access-client-secret");

  if (!clientId || !clientSecret) return false;

  const idBuf = Buffer.from(clientId);
  const expectedIdBuf = Buffer.from(config.serviceClientId);
  const secBuf = Buffer.from(clientSecret);
  const expectedSecBuf = Buffer.from(config.serviceClientSecret);

  if (idBuf.length !== expectedIdBuf.length || !crypto.timingSafeEqual(idBuf, expectedIdBuf)) {
    return false;
  }

  if (secBuf.length !== expectedSecBuf.length || !crypto.timingSafeEqual(secBuf, expectedSecBuf)) {
    return false;
  }

  return true;
}

/**
 * Evaluates whether an incoming request satisfies Cloudflare Access perimeter
 * Returns null if passthrough allowed (e.g. dev/local when not required),
 * or returns verify result.
 */
export async function evaluateCloudflareAccess(
  req: Request
): Promise<{ passed: boolean; error?: string; payload?: CloudflareAccessPayload }> {
  const config = getCloudflareAccessConfig();

  // 1. Check Service Token headers for automated clients / workers
  if (verifyCloudflareServiceTokenHeaders(req, config)) {
    return {
      passed: true,
      payload: {
        aud: config.expectedAud || "",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        nbf: Math.floor(Date.now() / 1000),
        iss: config.teamDomain || "cloudflare-service-token",
        type: "app",
        identity_type: "service",
        sub: config.serviceClientId || "service-token",
      },
    };
  }

  const token = extractCloudflareToken(req);

  // 2. If no token provided:
  if (!token) {
    if (config.required) {
      return {
        passed: false,
        error: "Outer perimeter verification required. Missing Cloudflare Access token.",
      };
    }
    // Passthrough (e.g. localhost or when Cloudflare Access is not strictly enforced)
    return { passed: true };
  }

  // 3. Token is provided: must verify cleanly
  const result = await verifyCloudflareJwt(token, {
    teamDomain: config.teamDomain,
    expectedAud: config.expectedAud,
  });

  if (!result.valid) {
    return {
      passed: false,
      error: `Cloudflare Access verification failed: ${result.reason || "invalid_token"}`,
    };
  }

  return { passed: true, payload: result.payload };
}
