import { getWebAuthnConfig } from "./auth.service";

/**
 * n0th1ng AI - Production Security Service
 * Implements CSRF defense-in-depth and HTTP security response headers
 */

export interface CsrfValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Derives all permitted HTTP origins for the active workstation instance
 */
export function getAllowedOrigins(req: Request): string[] {
  const origins = new Set<string>();

  // 1. Common local development origins
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  origins.add("http://localhost:5173");
  origins.add("http://127.0.0.1:5173");

  // 2. Dynamic host and forwarded host headers
  const forwardedProto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const cleanHost = host.trim().toLowerCase();
    origins.add(`${forwardedProto}://${cleanHost}`);
    // Support both HTTP and HTTPS variants for reverse proxy environments
    origins.add(`http://${cleanHost}`);
    origins.add(`https://${cleanHost}`);
  }

  // 3. Environment overrides
  if (process.env.ALLOWED_ORIGINS) {
    for (const item of process.env.ALLOWED_ORIGINS.split(",")) {
      const clean = item.trim().toLowerCase();
      if (clean) origins.add(clean);
    }
  }

  if (process.env.WEBAUTHN_ORIGIN) {
    origins.add(process.env.WEBAUTHN_ORIGIN.trim().toLowerCase());
  }

  return Array.from(origins);
}

/**
 * Validates incoming state-changing requests against CSRF attacks
 */
export function validateCsrfProtection(req: Request): CsrfValidationResult {
  const method = req.method.toUpperCase();

  // Safe HTTP methods do not change workstation state
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return { valid: true };
  }

  // Machine Worker Lane exemption:
  // Automated cluster daemons and background workers pass pre-shared API keys
  // or Cloudflare Service Tokens rather than browser session cookies.
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return { valid: true };
  }
  if (req.headers.get("x-workstation-key")) {
    return { valid: true };
  }
  if (req.headers.get("cf-access-client-id") && req.headers.get("cf-access-client-secret")) {
    return { valid: true };
  }

  // 1. Fetch Metadata Request Headers (Modern Browsers: Sec-Fetch-Site)
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    const site = secFetchSite.trim().toLowerCase();
    if (site === "cross-site") {
      return { valid: false, reason: "cross_site_fetch_rejected" };
    }
    if (["same-origin", "same-site", "none"].includes(site)) {
      return { valid: true };
    }
  }

  // 2. Origin / Referer Header Verification
  const originHeader = req.headers.get("origin");
  const refererHeader = req.headers.get("referer");

  let sourceOrigin: string | null = null;
  if (originHeader) {
    sourceOrigin = originHeader.trim().toLowerCase();
  } else if (refererHeader) {
    try {
      const parsed = new URL(refererHeader);
      sourceOrigin = parsed.origin.toLowerCase();
    } catch {
      return { valid: false, reason: "malformed_referer_header" };
    }
  }

  // If no Origin or Referer header was provided (e.g. non-browser scripts, curl, or tests)
  // we allow execution since no cross-site origin was signaled.
  if (!sourceOrigin) {
    return { valid: true };
  }

  // Compare against allowed origins
  const allowed = getAllowedOrigins(req);
  const isMatch = allowed.some((allowedOrigin) => {
    return sourceOrigin === allowedOrigin.toLowerCase();
  });

  if (!isMatch) {
    return {
      valid: false,
      reason: `origin_not_allowed: ${sourceOrigin}`,
    };
  }

  return { valid: true };
}

/**
 * Injects mandatory security response headers on every response
 */
export function applySecurityHeaders(headers: Headers, req: Request): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-XSS-Protection", "1; mode=block");

  // HSTS: Only when requested via HTTPS or through an HTTPS reverse proxy
  const isHttps =
    req.headers.get("x-forwarded-proto") === "https" ||
    req.url.startsWith("https://");
  if (isHttps) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}
