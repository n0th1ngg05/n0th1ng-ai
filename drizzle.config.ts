import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.WORKER_DATABASE_URL;
if (!url) throw new Error("WORKER_DATABASE_URL is required");

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./src/db/migrations",
    dialect: "mysql",
    dbCredentials: { url },
});
