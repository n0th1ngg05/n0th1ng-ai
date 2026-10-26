import readline from "readline";
import crypto from "crypto";
import { getDbAsync } from "../api/queries/connection";
import { setMasterPassword, revokeAllSessions, hasMasterPassword } from "../api/services/auth.service";

async function main() {
  console.log("=================================================");
  console.log("   n0th1ng AI — Workstation Auth Recovery Tool   ");
  console.log("=================================================");

  // Ensure DB is initialized
  await getDbAsync();

  // Parse command line arguments
  const args = process.argv.slice(2);
  let newPassword = "";
  for (const arg of args) {
    if (arg.startsWith("--password=")) {
      newPassword = arg.slice("--password=".length);
    }
  }

  const isConfigured = await hasMasterPassword();
  console.log(`Current Status: ${isConfigured ? "Password Configured" : "No Password Configured (Uninitialized)"}`);

  if (!newPassword) {
    // If not provided in CLI flag, prompt interactively
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const promptUser = (query: string): Promise<string> =>
      new Promise((resolve) => rl.question(query, resolve));

    const entered = await promptUser("Enter new Master Password (min 8 chars, or press Enter for auto-generated): ");
    rl.close();

    if (entered.trim().length >= 8) {
      newPassword = entered.trim();
    } else if (entered.trim().length === 0) {
      newPassword = crypto.randomBytes(12).toString("base64url");
      console.log(`Generated secure passphrase: ${newPassword}`);
    } else {
      console.error("Password must be at least 8 characters long.");
      process.exit(1);
    }
  }

  try {
    await setMasterPassword(newPassword);
    await revokeAllSessions();
    console.log("\n[SUCCESS] Master password has been securely updated via Argon2id.");
    console.log("[SUCCESS] All existing sessions have been revoked.");
    console.log("\nYou can now unlock the workstation at /login.html");
  } catch (err: any) {
    console.error("\n[ERROR] Failed to set password:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
