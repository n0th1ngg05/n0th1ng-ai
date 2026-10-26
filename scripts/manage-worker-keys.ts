import { getDbAsync } from "../api/queries/connection";
import { createWorkerApiKey, listWorkerApiKeys, revokeWorkerApiKey } from "../api/services/auth.service";

async function main() {
  await getDbAsync();

  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  console.log("==========================================================");
  console.log("     n0th1ng AI — Cluster Worker Key Management CLI       ");
  console.log("==========================================================");

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "create") {
    const label = args[1];
    if (!label) {
      console.error("\n[ERROR] Missing worker label.");
      console.log("Usage: npx tsx scripts/manage-worker-keys.ts create <label>");
      console.log("Example: npx tsx scripts/manage-worker-keys.ts create \"Desktop RTX 4090\"");
      process.exit(1);
    }

    try {
      const result = await createWorkerApiKey(label);
      console.log("\n[SUCCESS] New worker API key created!");
      console.log("----------------------------------------------------------");
      console.log(`Key ID        : ${result.id}`);
      console.log(`Label         : ${result.label}`);
      console.log(`Raw API Key   : ${result.plaintextKey}`);
      console.log(`Key Hash      : ${result.keyHash}`);
      console.log("----------------------------------------------------------");
      console.log("\nIMPORTANT: Save this key now! The raw key will never be shown again.");
      console.log("\nWorker Onboarding Setup:");
      console.log("1. On the worker machine, set this key in its environment or .env:");
      console.log(`   WORKER_API_KEY=${result.plaintextKey}`);
      console.log("2. Or in the master .env for pull-based polling:");
      console.log(`   WORKER_DESKTOP_KEY=${result.plaintextKey}`);
      console.log("3. The worker can now authenticate push requests via header:");
      console.log(`   Authorization: Bearer ${result.plaintextKey}`);
      console.log("   OR");
      console.log(`   X-Workstation-Key: ${result.plaintextKey}\n`);
    } catch (err: any) {
      console.error("\n[ERROR] Failed to create worker key:", err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "list") {
    try {
      const keys = await listWorkerApiKeys();
      if (keys.length === 0) {
        console.log("\nNo worker API keys found in database.");
        console.log("Run 'create <label>' to provision your first worker key.\n");
      } else {
        console.log(`\nFound ${keys.length} worker key(s):\n`);
        console.log("ID  | Label                     | Status   | Last Used            | Created");
        console.log("----+---------------------------+----------+----------------------+---------------------");
        for (const k of keys) {
          const status = k.revokedAt ? "REVOKED" : "ACTIVE";
          const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never";
          const created = new Date(k.createdAt).toLocaleDateString();
          const idStr = String(k.id).padEnd(3);
          const labelStr = (k.label || "Unnamed").slice(0, 25).padEnd(25);
          const statusStr = status.padEnd(8);
          const lastUsedStr = lastUsed.slice(0, 20).padEnd(20);
          console.log(`${idStr} | ${labelStr} | ${statusStr} | ${lastUsedStr} | ${created}`);
        }
        console.log("");
      }
    } catch (err: any) {
      console.error("\n[ERROR] Failed to list worker keys:", err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === "revoke") {
    const id = parseInt(args[1], 10);
    if (isNaN(id)) {
      console.error("\n[ERROR] Missing or invalid worker key ID.");
      console.log("Usage: npx tsx scripts/manage-worker-keys.ts revoke <id>");
      process.exit(1);
    }

    try {
      const ok = await revokeWorkerApiKey(id);
      if (ok) {
        console.log(`\n[SUCCESS] Worker key #${id} has been permanently revoked.`);
      } else {
        console.log(`\n[WARNING] Worker key #${id} was not found.`);
      }
    } catch (err: any) {
      console.error("\n[ERROR] Failed to revoke worker key:", err.message);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error(`\n[ERROR] Unknown command: "${command}"`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  console.log("\nUsage:");
  console.log("  npx tsx scripts/manage-worker-keys.ts <command> [arguments]\n");
  console.log("Commands:");
  console.log("  create <label>     Generate and hash a new worker API key");
  console.log("  list               Display all registered worker keys and their status");
  console.log("  revoke <id>        Revoke a worker key so it can no longer connect");
  console.log("  help               Show this help message\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
