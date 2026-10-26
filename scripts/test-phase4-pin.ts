import {
  createDeviceTrust,
  getDeviceTrust,
  verifyDevicePin,
  setDevicePin,
  revokeDeviceTrust,
  revokeAllDeviceTrust,
  parseDeviceTrustToken,
  signDeviceTrustToken,
  createSession,
  verifySession,
} from "../api/services/auth.service";
import { getDbAsync } from "../api/queries/connection";

async function runTests() {
  await getDbAsync();
  console.log("=== Phase 4 Device Trust & Quick PIN Tests ===");

  // 1. Signature & Tamper Resistance
  console.log("\n1. Testing Device Trust Token Signing & Tamper Verification...");
  const rawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const signedCookie = signDeviceTrustToken(rawToken);
  console.log("  Signed cookie format:", signedCookie);
  if (!signedCookie.startsWith(rawToken + ".")) {
    throw new Error("Signed cookie must contain raw token followed by signature");
  }

  const parsedValid = parseDeviceTrustToken(signedCookie);
  if (parsedValid !== rawToken) {
    throw new Error(`Parsing valid token failed. Expected ${rawToken}, got ${parsedValid}`);
  }

  // Tampered payload
  const tamperedPayload = rawToken.replace("0", "1") + signedCookie.slice(rawToken.length);
  const parsedTamperedPayload = parseDeviceTrustToken(tamperedPayload);
  if (parsedTamperedPayload !== null) {
    throw new Error("Tampered token payload must be rejected with null");
  }

  // Tampered signature
  const tamperedSig = signedCookie.slice(0, -4) + "0000";
  const parsedTamperedSig = parseDeviceTrustToken(tamperedSig);
  if (parsedTamperedSig !== null) {
    throw new Error("Tampered token signature must be rejected with null");
  }
  console.log("  ✓ Token signature and tamper resistance verified.");

  // 2. PIN Validation & Argon2id Hashing
  console.log("\n2. Testing PIN Validation & Argon2id Hashing...");
  try {
    await createDeviceTrust({ pin: "abc" }); // non-numeric
    throw new Error("Non-numeric PIN should fail validation");
  } catch (err: any) {
    if (!err.message.includes("PIN must be between 4 and 8 digits")) throw err;
  }

  try {
    await createDeviceTrust({ pin: "12" }); // too short
    throw new Error("Too short PIN should fail validation");
  } catch (err: any) {
    if (!err.message.includes("PIN must be between 4 and 8 digits")) throw err;
  }
  console.log("  ✓ PIN length and digit validation verified.");

  // 3. Database Insertion & Verification Flow
  console.log("\n3. Testing Device Trust Database Insertion & PIN Verification...");
  await revokeAllDeviceTrust();

  const testPin = "749201";
  const { cookieValue, expiresAt } = await createDeviceTrust({
    pin: testPin,
    deviceFingerprint: "Test Mac/Chrome",
    maxAgeDays: 30,
  });

  console.log("  Created device trust row with cookie:", cookieValue);
  const deviceRecord = await getDeviceTrust(cookieValue);
  if (!deviceRecord || deviceRecord.deviceFingerprint !== "Test Mac/Chrome") {
    throw new Error("Failed to retrieve created device trust record");
  }
  if (!deviceRecord.pinHash || !deviceRecord.pinHash.startsWith("$argon2id$")) {
    throw new Error("PIN must be hashed with Argon2id");
  }
  console.log("  ✓ Device trust record created and PIN verified as Argon2id hash.");

  // Verify with correct PIN
  const verifySuccess = await verifyDevicePin(cookieValue, testPin);
  console.log("  Verification with correct PIN:", verifySuccess);
  if (!verifySuccess.valid) throw new Error("Verification with correct PIN should succeed");
  console.log("  ✓ Correct PIN successfully verified!");

  // Verify with incorrect PIN
  const verifyFail = await verifyDevicePin(cookieValue, "999999");
  console.log("  Verification with incorrect PIN:", verifyFail);
  if (verifyFail.valid || verifyFail.reason !== "invalid_pin") {
    throw new Error("Incorrect PIN must fail with reason 'invalid_pin'");
  }
  console.log("  ✓ Incorrect PIN rejected.");

  // Verify with untrusted/missing cookie
  const verifyUntrusted = await verifyDevicePin(undefined, testPin);
  if (verifyUntrusted.valid || verifyUntrusted.reason !== "not_trusted") {
    throw new Error("Missing device trust cookie must fail with reason 'not_trusted'");
  }
  console.log("  ✓ Missing cookie rejected with 'not_trusted'.");

  // 4. Session Scope Enforcement (PIN sessions must have scope: 'standard')
  console.log("\n4. Testing Session Scope for PIN Unlocked Sessions...");
  const sessionResult = await createSession({
    methodUsed: "pin",
    scope: "standard",
    deviceLabel: deviceRecord.deviceFingerprint || "Test Device",
    ip: "127.0.0.1",
    rememberMe: true,
  });

  const session = await verifySession(sessionResult.cookieValue, "127.0.0.1");
  if (!session) throw new Error("Failed to verify newly minted PIN session");
  console.log("  Verified PIN Session:", {
    methodUsed: session.methodUsed,
    scope: session.scope,
    deviceLabel: session.deviceLabel,
  });

  if (session.methodUsed !== "pin") {
    throw new Error(`Expected methodUsed: 'pin', got '${session.methodUsed}'`);
  }
  if (session.scope !== "standard") {
    throw new Error(`PIN session MUST have scope 'standard', got '${session.scope}'`);
  }
  console.log("  ✓ PIN session correctly scoped to 'standard' (isolated from forge_unlocked).");

  // 5. Updating PIN & Revocation
  console.log("\n5. Testing PIN Update & Device Trust Revocation...");
  const newPin = "481516";
  const updateSuccess = await setDevicePin(cookieValue, newPin);
  if (!updateSuccess) throw new Error("Failed to update device PIN");

  const verifyOld = await verifyDevicePin(cookieValue, testPin);
  if (verifyOld.valid) throw new Error("Old PIN should no longer be valid");

  const verifyNew = await verifyDevicePin(cookieValue, newPin);
  if (!verifyNew.valid) throw new Error("New PIN should be valid");
  console.log("  ✓ PIN update verified.");

  // Revoke trust
  const revokeRes = await revokeDeviceTrust(cookieValue);
  if (!revokeRes) throw new Error("Revocation returned false");

  const postRevokeDevice = await getDeviceTrust(cookieValue);
  if (postRevokeDevice !== null) {
    throw new Error("Device trust row should be deleted after revocation");
  }

  const postRevokeVerify = await verifyDevicePin(cookieValue, newPin);
  if (postRevokeVerify.valid || postRevokeVerify.reason !== "not_trusted") {
    throw new Error("Post-revocation PIN attempt must fail with 'not_trusted'");
  }
  console.log("  ✓ Device trust revocation verified.");

  await revokeAllDeviceTrust();
  console.log("  Cleaned up test device trust records.");

  console.log("\n=== ALL PHASE 4 TESTS PASSED PERFECTLY ===");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
