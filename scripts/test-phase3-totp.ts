import {
  encryptSecret,
  decryptSecret,
  createPendingTotpToken,
  getPendingTotpToken,
  deletePendingTotpToken,
  verifyTotpCode,
  enrollTotp,
  confirmTotpEnrollment,
  verifyTotpLogin,
  hasTotpEnabled,
  disableTotp,
} from "../api/services/auth.service";
import { getDbAsync } from "../api/queries/connection";
import speakeasy from "speakeasy";

async function runTests() {
  await getDbAsync();
  console.log("=== Phase 3 TOTP & Replay Protection Tests ===");

  // 1. Secret Encryption / Decryption Round-Trip
  console.log("\n1. Testing AES-256-GCM secret encryption/decryption...");
  const rawSecret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSecret(rawSecret);
  console.log("  Encrypted format:", encrypted);
  if (!encrypted.includes(".")) throw new Error("Encrypted blob must have iv.authTag.ciphertext format");
  const decrypted = decryptSecret(encrypted);
  if (decrypted !== rawSecret) throw new Error(`Decryption mismatch: expected ${rawSecret}, got ${decrypted}`);
  console.log("  ✓ Encryption/Decryption round-trip verified.");

  // 2. Pending TOTP Token In-Memory Store
  console.log("\n2. Testing Pending TOTP token lifecycle...");
  const pendingToken = createPendingTotpToken({
    ip: "127.0.0.1",
    rememberMe: true,
    deviceLabel: "Test Device",
  });
  console.log("  Generated pending token:", pendingToken);
  const retrieved = getPendingTotpToken(pendingToken);
  if (!retrieved || retrieved.ip !== "127.0.0.1" || retrieved.rememberMe !== true) {
    throw new Error("Failed to retrieve pending TOTP token");
  }
  deletePendingTotpToken(pendingToken);
  if (getPendingTotpToken(pendingToken) !== null) {
    throw new Error("Pending token should have been deleted");
  }
  console.log("  ✓ Pending token store verified.");

  // 3. TOTP RFC 6238 Algorithm & Replay Prevention Logic
  console.log("\n3. Testing TOTP verification with window=1 & Replay Protection...");
  const testSecret = speakeasy.generateSecret({ length: 20 }).base32;
  const currentStep = Math.floor(Date.now() / 1000 / 30);

  // Generate valid code for current step
  const codeCurrent = speakeasy.totp({
    secret: testSecret,
    encoding: "base32",
    time: currentStep * 30,
  });

  // Verify fresh code (no previous step consumed)
  const res1 = verifyTotpCode(testSecret, codeCurrent, null);
  console.log("  First verification of current step:", res1);
  if (!res1.valid || res1.step !== currentStep) {
    throw new Error("Fresh TOTP code should be valid");
  }

  // REPLAY ATTEMPT: Same code again with lastVerifiedStep = currentStep
  const resReplay = verifyTotpCode(testSecret, codeCurrent, currentStep);
  console.log("  Replay attempt with same code (step consumed):", resReplay);
  if (resReplay.valid || resReplay.reason !== "code_already_used") {
    throw new Error("Replayed TOTP code MUST be rejected with 'code_already_used'");
  }
  console.log("  ✓ Replay attempt successfully blocked!");

  // Previous window (step - 1) attempt when current step was already consumed
  const codePrev = speakeasy.totp({
    secret: testSecret,
    encoding: "base32",
    time: (currentStep - 1) * 30,
  });
  const resOld = verifyTotpCode(testSecret, codePrev, currentStep);
  console.log("  Past code (step - 1) attempt when current step is consumed:", resOld);
  if (resOld.valid || resOld.reason !== "code_already_used") {
    throw new Error("Past step must also be rejected if newer step was consumed");
  }
  console.log("  ✓ Past window replay blocked!");

  // Future window (step + 1)
  const codeNext = speakeasy.totp({
    secret: testSecret,
    encoding: "base32",
    time: (currentStep + 1) * 30,
  });
  const resNext = verifyTotpCode(testSecret, codeNext, currentStep);
  console.log("  Future step (step + 1) verification:", resNext);
  if (!resNext.valid || resNext.step !== currentStep + 1) {
    throw new Error("Step + 1 should be accepted within window=1");
  }
  console.log("  ✓ Window=1 drift tolerance verified!");

  // 4. End-to-End DB Enrollment & Login Flow
  console.log("\n4. Testing End-to-End Database Enrollment & Login Verification...");
  // Clean up any existing TOTP secrets first
  await disableTotp();

  const initialEnabled = await hasTotpEnabled();
  if (initialEnabled) throw new Error("TOTP should be disabled initially");

  // Step A: Enroll
  const enrollment = await enrollTotp();
  console.log("  Enrolled secret:", enrollment.secret);
  console.log("  Enrolled URI:", enrollment.uri);
  if (!enrollment.qrCode.startsWith("data:image/png;base64,")) {
    throw new Error("QR Code should be data URL");
  }

  // Step B: Confirm enrollment with valid code
  const enrollStep = Math.floor(Date.now() / 1000 / 30);
  const enrollCode = speakeasy.totp({
    secret: enrollment.secret,
    encoding: "base32",
    time: enrollStep * 30,
  });

  const confirmRes = await confirmTotpEnrollment(enrollCode);
  console.log("  Enrollment confirmation result:", confirmRes);
  if (!confirmRes.success) throw new Error("Enrollment confirmation failed: " + confirmRes.error);

  const isEnabled = await hasTotpEnabled();
  if (!isEnabled) throw new Error("TOTP should now be enabled in DB");
  console.log("  ✓ TOTP enrollment confirmed and enabled in DB!");

  // Step C: Attempt replay of the confirmation code during login
  const loginReplayRes = await verifyTotpLogin(enrollCode);
  console.log("  Replay of confirmation code during login:", loginReplayRes);
  if (loginReplayRes.valid || loginReplayRes.reason !== "code_already_used") {
    throw new Error("Code used for enrollment must NOT be reusable for login!");
  }
  console.log("  ✓ Cross-step replay between enrollment and login blocked!");

  // Step D: Legitimate login with fresh next-step code
  const loginStep = enrollStep + 1;
  const loginCode = speakeasy.totp({
    secret: enrollment.secret,
    encoding: "base32",
    time: loginStep * 30,
  });

  const loginRes = await verifyTotpLogin(loginCode);
  console.log("  Login verification with fresh code:", loginRes);
  if (!loginRes.valid || loginRes.step !== loginStep) {
    throw new Error("Legitimate login with fresh code should succeed");
  }
  console.log("  ✓ Legitimate login verified!");

  // Step E: Replay that login code immediately
  const loginReplay2 = await verifyTotpLogin(loginCode);
  console.log("  Immediate replay of login code:", loginReplay2);
  if (loginReplay2.valid || loginReplay2.reason !== "code_already_used") {
    throw new Error("Login code must NOT be reusable!");
  }
  console.log("  ✓ Login code replay blocked!");

  // Clean up
  await disableTotp();
  console.log("  Cleaned up test TOTP secrets.");

  console.log("\n=== ALL PHASE 3 TESTS PASSED PERFECTLY ===");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
