import { getDbAsync, getDb } from "../api/queries/connection";
import { authWebauthnCredentials } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  getWebAuthnConfig,
  saveWebAuthnChallenge,
  consumeWebAuthnChallenge,
  hasWebAuthnCredentials,
  listWebAuthnCredentials,
  deleteWebAuthnCredential,
  getWebAuthnRegistrationOptions,
  getWebAuthnLoginOptions,
} from "../api/services/auth.service";
import { authRouter } from "../api/routers/auth.router";

async function runTests() {
  console.log("=================================================");
  console.log("n0th1ng AI - Phase 5 WebAuthn / Passkeys Test Suite");
  console.log("=================================================\n");

  await getDbAsync();
  const db = getDb();

  // Clean up any test WebAuthn credentials
  await db.delete(authWebauthnCredentials).where(eq(authWebauthnCredentials.deviceLabel, "Test-Passkey-Device"));

  // 1. Config resolution
  console.log("Test 1: WebAuthn Config Resolution (Dynamic Host/Origin)...");
  const dummyReq = new Request("http://localhost:3000/api/auth/webauthn/login-options", {
    headers: {
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    },
  });
  const config = getWebAuthnConfig(dummyReq);
  if (config.rpID !== "localhost") {
    throw new Error(`Expected rpID 'localhost', got '${config.rpID}'`);
  }
  if (!config.expectedOrigins.includes("http://localhost:3000")) {
    throw new Error("expectedOrigins missing http://localhost:3000");
  }
  console.log("✓ WebAuthn config dynamically resolves rpID and origins correctly.\n");

  // 2. Challenge store & single-use replay protection
  console.log("Test 2: Challenge Store & Single-Use Replay Protection...");
  const testChallenge = "test-challenge-abc-123";
  saveWebAuthnChallenge(testChallenge, "registration");

  // Consuming with wrong type must fail
  const wrongType = consumeWebAuthnChallenge(testChallenge, "authentication");
  if (wrongType) {
    throw new Error("Challenge consumed with wrong type!");
  }

  // Consuming with correct type must succeed
  const firstConsume = consumeWebAuthnChallenge(testChallenge, "registration");
  if (!firstConsume) {
    throw new Error("Failed to consume valid challenge!");
  }

  // Replay attempt must fail (consumed once)
  const replayAttempt = consumeWebAuthnChallenge(testChallenge, "registration");
  if (replayAttempt) {
    throw new Error("Replay protection failed! Challenge was consumed twice.");
  }
  console.log("✓ Challenge store enforces type safety and strictly prevents replay.\n");

  // 3. Registration options generation
  console.log("Test 3: Registration Options Generation...");
  const regOptions = await getWebAuthnRegistrationOptions(dummyReq);
  if (!regOptions.challenge || !regOptions.rp || regOptions.rp.id !== "localhost") {
    throw new Error("Invalid registration options returned!");
  }
  console.log("✓ Registration options successfully generated with operator identity.\n");

  // 4. Credential listing and DB operations
  console.log("Test 4: Database Credential Lifecycle...");
  const initialCount = (await listWebAuthnCredentials()).length;

  const testCredId = "test-credential-id-" + Date.now();
  await db.insert(authWebauthnCredentials).values({
    credentialId: testCredId,
    publicKey: "dummy-public-key-base64",
    counter: 0,
    deviceLabel: "Test-Passkey-Device",
    transports: ["internal", "hybrid"],
  });

  const hasCreds = await hasWebAuthnCredentials();
  if (!hasCreds) {
    throw new Error("Expected hasWebAuthnCredentials to be true!");
  }

  const credentials = await listWebAuthnCredentials();
  const created = credentials.find((c) => c.credentialId === testCredId);
  if (!created || created.deviceLabel !== "Test-Passkey-Device") {
    throw new Error("Created passkey credential not found in list!");
  }

  // Check login options with active credential
  const loginOpts = await getWebAuthnLoginOptions(dummyReq);
  if (!loginOpts.available || !loginOpts.options) {
    throw new Error("Expected login options to be available!");
  }
  const hasAllow = loginOpts.options.allowCredentials?.some((c) => c.id === testCredId);
  if (!hasAllow) {
    throw new Error("allowCredentials does not contain test credential!");
  }
  console.log("✓ Passkey credential stored and matched in authentication options.\n");

  // Delete credential
  console.log("Test 5: Credential Deletion & Cleanup...");
  const deleted = await deleteWebAuthnCredential(created.id);
  if (!deleted) {
    throw new Error("Failed to delete credential!");
  }

  const afterDeleteList = await listWebAuthnCredentials();
  if (afterDeleteList.some((c) => c.id === created.id)) {
    throw new Error("Credential still exists after delete!");
  }
  console.log("✓ Passkey credential successfully revoked and removed from DB.\n");

  // 6. Router HTTP Endpoints
  console.log("Test 6: Router Endpoints Verification...");
  // Status endpoint
  const statusRes = await authRouter.fetch(new Request("http://localhost/webauthn/status"));
  const statusJson = await statusRes.json();
  if (statusRes.status !== 200 || typeof statusJson.available !== "boolean") {
    throw new Error("GET /webauthn/status failed!");
  }

  // Protected endpoint without session must return 401
  const protectedRes = await authRouter.fetch(
    new Request("http://localhost/webauthn/credentials", {
      method: "GET",
    })
  );
  if (protectedRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated credentials list, got ${protectedRes.status}`);
  }

  const registerOptsRes = await authRouter.fetch(
    new Request("http://localhost/webauthn/register-options", {
      method: "POST",
    })
  );
  if (registerOptsRes.status !== 401) {
    throw new Error(`Expected 401 for unauthenticated register-options, got ${registerOptsRes.status}`);
  }
  console.log("✓ HTTP router endpoints correctly enforce authorization and status checks.\n");

  console.log("=================================================");
  console.log("ALL PHASE 5 TESTS PASSED (100% SUCCESS)!");
  console.log("=================================================\n");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
