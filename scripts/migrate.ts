// Standalone migration runner for production/Docker (no drizzle-kit needed).
// Bundled to dist/migrate.js by the Dockerfile.
import "dotenv/config";
import path from "node:path";
import { createConnection } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const conn = await createConnection(url);
  try {
    await migrate(drizzle(conn), { migrationsFolder: path.resolve(process.cwd(), "db/migrations") });
    console.log("[migrate] Migrations applied.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
