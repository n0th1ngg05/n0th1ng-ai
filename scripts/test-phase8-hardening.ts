import {
  validateCsrfProtection,
  applySecurityHeaders,
  getAllowedOrigins,
} from "../api/services/security.service";
import app from "../api/boot";

async function runTests() {
  console.log("=================================================");
  console.log("n0th1ng AI - Phase 8 Production Hardening Test Suite");
  console.log("=================================================\n");

  // 1. Allowed Origins Resolution
  console.log("Test 1: Allowed Origins Resolution...");
  const devReq = new Request("http://localhost:3000/api/auth/login", {
    headers: { host: "localhost:3000" },
  });
  const origins = getAllowedOrigins(devReq);
  if (!origins.includes("http://localhost:3000") || !origins.includes("http://127.0.0.1:3000")) {
    throw new Error("Default local dev origins missing from allowed origins!");
  }

  // Forwarded host in cloud proxy
  const cloudReq = new Request("http://127.0.0.1:3000/api/auth/login", {
    headers: {
      host: "127.0.0.1:3000",
      "x-forwarded-host": "n0th1ng.ai",
      "x-forwarded-proto": "https",
    },
  });
  const cloudOrigins = getAllowedOrigins(cloudReq);
  if (!cloudOrigins.includes("https://n0th1ng.ai")) {
    throw new Error("Forwarded cloud origin was not properly resolved!");
  }
  console.log("✓ Allowed origins dynamically resolved for both local workstation and cloud proxy.\n");

  // 2. CSRF Sec-Fetch-Site Metadata Checks
  console.log("Test 2: Fetch Metadata (Sec-Fetch-Site) Protection...");
  const crossSiteReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://evil-attacker.com",
    },
  });
  const crossSiteCheck = validateCsrfProtection(crossSiteReq);
  if (crossSiteCheck.valid) {
    throw new Error("Cross-site request was not blocked!");
  }
  if (crossSiteCheck.reason !== "cross_site_fetch_rejected") {
    throw new Error(`Unexpected reason for cross-site rejection: ${crossSiteCheck.reason}`);
  }

  const sameOriginReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
    },
  });
  const sameOriginCheck = validateCsrfProtection(sameOriginReq);
  if (!sameOriginCheck.valid) {
    throw new Error(`Same-origin request was blocked: ${sameOriginCheck.reason}`);
  }
  console.log("✓ Modern Sec-Fetch-Site metadata correctly blocks cross-site and permits same-origin.\n");

  // 3. Origin Header Validation & Spoofing Defense
  console.log("Test 3: Origin / Referer Validation...");
  const mismatchedOriginReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      origin: "https://imposter-domain.xyz",
    },
  });
  const mismatchCheck = validateCsrfProtection(mismatchedOriginReq);
  if (mismatchCheck.valid) {
    throw new Error("Mismatched origin was accepted!");
  }

  const validOriginReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
    },
  });
  const validOriginCheck = validateCsrfProtection(validOriginReq);
  if (!validOriginCheck.valid) {
    throw new Error(`Valid origin was blocked: ${validOriginCheck.reason}`);
  }
  console.log("✓ Origin and Referer mismatch defense blocks external callers and allows valid host.\n");

  // 4. Safe Methods & Worker Exemption
  console.log("Test 4: Safe Methods & Machine Worker Lane Exemption...");
  const getReq = new Request("http://localhost:3000/api/models", {
    method: "GET",
    headers: {
      "sec-fetch-site": "cross-site", // Safe method GET should not trigger CSRF rejection
    },
  });
  if (!validateCsrfProtection(getReq).valid) {
    throw new Error("Safe GET request was blocked by CSRF validator!");
  }

  const workerBearerReq = new Request("http://localhost:3000/api/cluster/heartbeat", {
    method: "POST",
    headers: {
      authorization: "Bearer mock-worker-key-12345",
      "sec-fetch-site": "cross-site",
    },
  });
  if (!validateCsrfProtection(workerBearerReq).valid) {
    throw new Error("Machine worker request with Bearer key was blocked by CSRF validator!");
  }

  const workerHeaderReq = new Request("http://localhost:3000/api/cluster/heartbeat", {
    method: "POST",
    headers: {
      "x-workstation-key": "mock-worker-key-12345",
      "sec-fetch-site": "cross-site",
    },
  });
  if (!validateCsrfProtection(workerHeaderReq).valid) {
    throw new Error("Machine worker request with X-Workstation-Key was blocked by CSRF validator!");
  }
  console.log("✓ Safe HTTP methods and machine worker authentication lanes exempt from browser CSRF.\n");

  // 5. Security Response Headers
  console.log("Test 5: Security Response Headers (HSTS, nosniff, DENY, Referrer-Policy)...");
  const headersHttp = new Headers();
  applySecurityHeaders(headersHttp, new Request("http://localhost:3000"));
  if (headersHttp.get("X-Content-Type-Options") !== "nosniff") {
    throw new Error("Missing X-Content-Type-Options: nosniff");
  }
  if (headersHttp.get("X-Frame-Options") !== "DENY") {
    throw new Error("Missing X-Frame-Options: DENY");
  }
  if (headersHttp.get("Referrer-Policy") !== "strict-origin-when-cross-origin") {
    throw new Error("Missing Referrer-Policy");
  }
  if (headersHttp.get("Strict-Transport-Security") !== null) {
    throw new Error("HSTS header unexpectedly set on plain HTTP request!");
  }

  const headersHttps = new Headers();
  applySecurityHeaders(
    headersHttps,
    new Request("http://localhost:3000", {
      headers: { "x-forwarded-proto": "https" },
    })
  );
  if (!headersHttps.get("Strict-Transport-Security")?.includes("max-age=31536000")) {
    throw new Error("Missing Strict-Transport-Security on HTTPS request!");
  }
  console.log("✓ Security headers enforced cleanly with conditional HSTS on HTTPS/proxy.\n");

  // 6. Live Gatekeeper Middleware Integration
  console.log("Test 6: Gatekeeper Middleware Live HTTP Request Pass...");
  // Cross-site attack to /api/auth/login must be rejected with 403 CSRF_DETECTED
  const liveAttackReq = new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      origin: "https://hacker.site",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: "wrong" }),
  });
  const attackRes = await app.fetch(liveAttackReq);
  if (attackRes.status !== 403) {
    throw new Error(`Expected HTTP 403 for cross-site attack, got ${attackRes.status}`);
  }
  const attackJson = await attackRes.json();
  if (attackJson.error !== "CSRF_DETECTED") {
    throw new Error(`Expected error CSRF_DETECTED, got ${attackJson.error}`);
  }
  if (attackRes.headers.get("X-Frame-Options") !== "DENY") {
    throw new Error("Response was missing X-Frame-Options header");
  }
  console.log("✓ Live cross-site POST blocked by gatekeeper middleware with HTTP 403 CSRF_DETECTED.\n");

  // Valid status request
  const liveStatusReq = new Request("http://localhost:3000/api/auth/status");
  const statusRes = await app.fetch(liveStatusReq);
  if (statusRes.status !== 200) {
    throw new Error(`Expected HTTP 200 from status, got ${statusRes.status}`);
  }
  if (statusRes.headers.get("X-Content-Type-Options") !== "nosniff") {
    throw new Error("Status response missing X-Content-Type-Options: nosniff");
  }
  console.log("✓ Gatekeeper allows legitimate requests and injects hardening headers.\n");

  console.log("=================================================");
  console.log("ALL PHASE 8 TESTS PASSED (100% SUCCESS)!");
  console.log("=================================================\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
