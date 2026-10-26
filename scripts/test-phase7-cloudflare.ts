import crypto from "crypto";
import {
  normalizeTeamDomain,
  verifyCloudflareJwt,
  setCachedCloudflareKeys,
  clearCloudflareKeysCache,
  extractCloudflareToken,
  evaluateCloudflareAccess,
  verifyCloudflareServiceTokenHeaders,
} from "../api/services/cloudflare.service";
import { authRouter } from "../api/routers/auth.router";

async function runTests() {
  console.log("=================================================");
  console.log("n0th1ng AI - Phase 7 Cloudflare Access Test Suite");
  console.log("=================================================\n");

  // 1. Team Domain Normalization
  console.log("Test 1: Team Domain Normalization...");
  if (normalizeTeamDomain("myteam") !== "https://myteam.cloudflareaccess.com") {
    throw new Error("normalizeTeamDomain('myteam') failed");
  }
  if (normalizeTeamDomain("https://myteam.cloudflareaccess.com/") !== "https://myteam.cloudflareaccess.com") {
    throw new Error("normalizeTeamDomain('https://myteam.cloudflareaccess.com/') failed");
  }
  if (normalizeTeamDomain("MYTEAM.cloudflareaccess.com") !== "https://myteam.cloudflareaccess.com") {
    throw new Error("normalizeTeamDomain case normalization failed");
  }
  if (normalizeTeamDomain("") !== null || normalizeTeamDomain(undefined) !== null) {
    throw new Error("normalizeTeamDomain null handling failed");
  }
  console.log("✓ Team domain normalization handles bare names, URLs, trailing slashes, and casing.\n");

  // 2. Localhost & Development Passthrough
  console.log("Test 2: Local Development Passthrough...");
  const devReq = new Request("http://localhost:3000/api/chat", {
    headers: { host: "localhost:3000" },
  });
  const devResult = await evaluateCloudflareAccess(devReq);
  if (!devResult.passed) {
    throw new Error("Local dev request without token unexpectedly failed perimeter check!");
  }
  console.log("✓ Requests pass through without friction when Cloudflare Access is not strictly required.\n");

  // 3. Cryptographic RS256 Key Setup & JWK Signing
  console.log("Test 3: RS256 Key Generation and JWK Registration...");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as any;
  jwk.kid = "cf-test-key-01";
  jwk.alg = "RS256";

  setCachedCloudflareKeys([jwk]);

  const teamDomain = "https://n0th1ng.cloudflareaccess.com";
  const expectedAud = "aud-tag-4567-8901";

  function createSignedJwt(payloadOverrides: any = {}, headerOverrides: any = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "RS256",
      kid: "cf-test-key-01",
      typ: "JWT",
      ...headerOverrides,
    };
    const payload = {
      aud: expectedAud,
      email: "operator@n0th1ng.ai",
      exp: now + 3600,
      iat: now,
      nbf: now - 10,
      iss: teamDomain,
      type: "app",
      identity_type: "user",
      sub: "operator-user-uuid-1234",
      country: "US",
      ...payloadOverrides,
    };

    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = crypto.sign("RSA-SHA256", signingInput, privateKey).toString("base64url");

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  // 4. Valid JWT Verification
  console.log("Test 4: Valid RS256 Cloudflare Access Assertion...");
  const validToken = createSignedJwt();
  const verifyResult = await verifyCloudflareJwt(validToken, {
    teamDomain,
    expectedAud,
  });

  if (!verifyResult.valid || !verifyResult.payload) {
    throw new Error(`Valid token failed verification: ${verifyResult.reason}`);
  }
  if (verifyResult.payload.email !== "operator@n0th1ng.ai" || verifyResult.payload.sub !== "operator-user-uuid-1234") {
    throw new Error("Payload fields were not correctly extracted!");
  }
  console.log("✓ Valid Cloudflare Access JWT verified with correct claims and signature.\n");

  // 5. Negative Security Checks (Tampering, Expiration, Mismatches)
  console.log("Test 5: Tampering, Expiration, and Issuer/Audience Protection...");

  // Tampered signature
  const tamperedToken = validToken.slice(0, -6) + "XXXXXX";
  const tamperedResult = await verifyCloudflareJwt(tamperedToken, { teamDomain, expectedAud });
  if (tamperedResult.valid) {
    throw new Error("Tampered token was accepted!");
  }

  // Expired token
  const now = Math.floor(Date.now() / 1000);
  const expiredToken = createSignedJwt({ exp: now - 300 });
  const expiredResult = await verifyCloudflareJwt(expiredToken, { teamDomain, expectedAud });
  if (expiredResult.valid || expiredResult.reason !== "token_expired") {
    throw new Error(`Expired token was not rejected with token_expired: ${expiredResult.reason}`);
  }

  // Audience mismatch
  const wrongAudToken = createSignedJwt({ aud: "wrong-audience-tag" });
  const wrongAudResult = await verifyCloudflareJwt(wrongAudToken, { teamDomain, expectedAud });
  if (wrongAudResult.valid || wrongAudResult.reason !== "audience_mismatch") {
    throw new Error(`Wrong audience was not rejected: ${wrongAudResult.reason}`);
  }

  // Issuer mismatch
  const wrongIssToken = createSignedJwt({ iss: "https://imposter.cloudflareaccess.com" });
  const wrongIssResult = await verifyCloudflareJwt(wrongIssToken, { teamDomain, expectedAud });
  if (wrongIssResult.valid || wrongIssResult.reason !== "issuer_mismatch") {
    throw new Error(`Wrong issuer was not rejected: ${wrongIssResult.reason}`);
  }

  // Unknown kid
  const wrongKidToken = createSignedJwt({}, { kid: "unknown-kid" });
  const wrongKidResult = await verifyCloudflareJwt(wrongKidToken, { teamDomain, expectedAud });
  if (wrongKidResult.valid || wrongKidResult.reason !== "unknown_signing_key") {
    throw new Error(`Unknown kid was not rejected: ${wrongKidResult.reason}`);
  }
  console.log("✓ Tampered tokens, expired tokens, audience mismatches, and unknown signing keys rejected.\n");

  // 6. Header and Cookie Extraction
  console.log("Test 6: Token Extraction (Header & Cookie)...");
  const reqWithHeader = new Request("http://localhost:3000", {
    headers: { "Cf-Access-Jwt-Assertion": validToken },
  });
  if (extractCloudflareToken(reqWithHeader) !== validToken) {
    throw new Error("Failed to extract token from Cf-Access-Jwt-Assertion header");
  }

  const reqWithCookie = new Request("http://localhost:3000", {
    headers: { cookie: `CF_Authorization=${encodeURIComponent(validToken)}` },
  });
  if (extractCloudflareToken(reqWithCookie) !== validToken) {
    throw new Error("Failed to extract token from CF_Authorization cookie");
  }
  console.log("✓ Token extraction succeeds from both Cf-Access-Jwt-Assertion header and CF_Authorization cookie.\n");

  // 7. Cloudflare Access Service Token Verification
  console.log("Test 7: Cloudflare Access Service Token Headers...");
  const serviceConfig = {
    teamDomain,
    expectedAud,
    required: false,
    serviceClientId: "cf-svc-id-12345",
    serviceClientSecret: "cf-svc-secret-abcdef67890",
  };

  const reqValidService = new Request("http://localhost:3000", {
    headers: {
      "cf-access-client-id": "cf-svc-id-12345",
      "cf-access-client-secret": "cf-svc-secret-abcdef67890",
    },
  });
  if (!verifyCloudflareServiceTokenHeaders(reqValidService, serviceConfig)) {
    throw new Error("Valid Cloudflare Access service token headers rejected!");
  }

  const reqInvalidService = new Request("http://localhost:3000", {
    headers: {
      "cf-access-client-id": "cf-svc-id-12345",
      "cf-access-client-secret": "wrong-secret",
    },
  });
  if (verifyCloudflareServiceTokenHeaders(reqInvalidService, serviceConfig)) {
    throw new Error("Invalid Cloudflare Access service token headers accepted!");
  }
  console.log("✓ Cloudflare Access service token headers verified with constant-time equality.\n");

  // 8. Outer Perimeter Enforcement Check
  console.log("Test 8: Outer Perimeter Enforcement (CF_ACCESS_REQUIRED)...");
  process.env.CF_ACCESS_REQUIRED = "true";
  process.env.CF_ACCESS_TEAM_DOMAIN = teamDomain;
  process.env.CF_ACCESS_AUD = expectedAud;

  const reqBlocked = new Request("http://localhost:3000/api/cluster/list");
  const blockedEval = await evaluateCloudflareAccess(reqBlocked);
  if (blockedEval.passed) {
    throw new Error("Unauthenticated request was not blocked when CF_ACCESS_REQUIRED=true!");
  }

  const reqAllowed = new Request("http://localhost:3000/api/cluster/list", {
    headers: { "Cf-Access-Jwt-Assertion": validToken },
  });
  const allowedEval = await evaluateCloudflareAccess(reqAllowed);
  if (!allowedEval.passed || !allowedEval.payload) {
    throw new Error(`Valid request was blocked when CF_ACCESS_REQUIRED=true! reason: ${allowedEval.error}`);
  }
  console.log("✓ Perimeter strictly enforced when CF_ACCESS_REQUIRED=true.\n");

  // Reset env
  delete process.env.CF_ACCESS_REQUIRED;
  delete process.env.CF_ACCESS_TEAM_DOMAIN;
  delete process.env.CF_ACCESS_AUD;
  clearCloudflareKeysCache();

  // 9. Status Endpoint Check
  console.log("Test 9: Router Status Endpoint (GET /api/auth/cloudflare/status)...");
  const statusRes = await authRouter.fetch(new Request("http://localhost/cloudflare/status"));
  if (statusRes.status !== 200) {
    throw new Error(`Expected 200 from /cloudflare/status, got ${statusRes.status}`);
  }
  const statusJson = await statusRes.json();
  if (typeof statusJson.configured !== "boolean" || typeof statusJson.tokenPresent !== "boolean") {
    throw new Error("Malformed status response from /cloudflare/status");
  }
  console.log("✓ GET /api/auth/cloudflare/status reports outer perimeter configuration.\n");

  console.log("=================================================");
  console.log("ALL PHASE 7 TESTS PASSED (100% SUCCESS)!");
  console.log("=================================================\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
