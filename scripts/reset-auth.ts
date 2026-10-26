import readline from "readline";
import crypto from "crypto";
import { getDbAsync } from "../api/queries/connection";
import { setMasterPassword, revokeAllSessions, hasMasterPassword, hasTotpEnabled, disableTotp } from "../api/services/auth.service";

async function main() {
  console.log("=================================================");
  console.log("   n0th1ng AI — Workstation Auth Recovery Tool   ");
  console.log("=================================================");

  // Ensure DB is initialized
  await getDbAsync();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let newPassword = "";
  let shouldResetTotp = false;

  for (const arg of args) {
    if (arg.startsWith("--password=")) {
      newPassword = arg.slice("--password=".length);
    }
    if (arg === "--reset-totp" || arg === "--disable-totp") {
      shouldResetTotp = true;
    }
  }

  const isConfigured = await hasMasterPassword();
  const totpActive = await hasTotpEnabled();
  console.log(`Master Password: ${isConfigured ? "Configured" : "Uninitialized"}`);
  console.log(`TOTP Second-Factor: ${totpActive ? "Active" : "Disabled"}`);

  if (!newPassword) {
    // If not provided in CLI flag, prompt interactively
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const promptUser = (query: string): Promise<string> =>
      new Promise((resolve) => rl.question(query, resolve));

    const entered = await promptUser("Enter new Master Password (min 8 chars, or press Enter for auto-generated): ");

    if (entered.trim().length >= 8) {
      newPassword = entered.trim();
    } else if (entered.trim().length === 0) {
      newPassword = crypto.randomBytes(12).toString("base64url");
      console.log(`Generated secure passphrase: ${newPassword}`);
    } else {
      console.error("Password must be at least 8 characters long.");
      rl.close();
      process.exit(1);
    }

    if (totpActive && !shouldResetTotp) {
      const resetTotpAnswer = await promptUser("TOTP is active. Disable TOTP to remove 2FA lockout? (y/N): ");
      if (resetTotpAnswer.trim().toLowerCase() === "y") {
        shouldResetTotp = true;
      }
    }
    rl.close();
  }

  try {
    await setMasterPassword(newPassword);
    await revokeAllSessions();
    console.log("\n[SUCCESS] Master password has been securely updated via Argon2id.");
    console.log("[SUCCESS] All existing sessions have been revoked.");

    if (shouldResetTotp) {
      await disableTotp();
      console.log("[SUCCESS] TOTP second-factor has been disabled.");
    }

    console.log("\nYou can now unlock the workstation at /login.html");
  } catch (err: any) {
    console.error("\n[ERROR] Recovery failed:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
