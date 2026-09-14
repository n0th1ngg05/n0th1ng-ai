import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

// ── Connection pool ───────────────────────────────────────────────────────────

const url = process.env.WORKER_DATABASE_URL;
if (!url) {
    throw new Error("[DB] WORKER_DATABASE_URL is not set in .env");
}

const pool = mysql.createPool(url);

export const db = drizzle(pool, { schema, mode: "default" });

// ── Bootstrap: push tables if they don't exist ────────────────────────────────
// We use raw SQL CREATE TABLE IF NOT EXISTS rather than running drizzle-kit
// migrations at runtime — keeps startup clean with no CLI dependency.

export async function initDb() {

    const conn = await pool.getConnection();

    try {

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS worker_config (
                \`key\`  VARCHAR(100) NOT NULL PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS worker_access_log (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                ts          BIGINT UNSIGNED NOT NULL,
                method      VARCHAR(10)  NOT NULL,
                path        VARCHAR(500) NOT NULL,
                status      INT          NOT NULL,
                duration_ms INT          NOT NULL,
                ip          VARCHAR(60),
                tool        VARCHAR(100),
                source      ENUM('local','remote') DEFAULT 'remote',
                INDEX idx_ts (ts)
            )
        `);

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS worker_tool_history (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                job_id      INT            NOT NULL,
                tool        VARCHAR(100)   NOT NULL,
                started_at  BIGINT UNSIGNED NOT NULL,
                duration_ms INT            NOT NULL,
                success     TINYINT(1)     NOT NULL,
                source      ENUM('local','remote') DEFAULT 'local',
                INDEX idx_started (started_at)
            )
        `);

        await conn.execute(`
            CREATE TABLE IF NOT EXISTS worker_metrics_snapshots (
                id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                ts          BIGINT UNSIGNED NOT NULL,
                cpu_pct     FLOAT,
                ram_gb      FLOAT,
                gpu_pct     FLOAT,
                gpu_temp    FLOAT,
                cpu_temp    FLOAT,
                rx_bps      BIGINT UNSIGNED,
                tx_bps      BIGINT UNSIGNED,
                active_jobs INT,
                is_exposed  TINYINT(1),
                INDEX idx_ts (ts)
            )
        `);

        // Seed default config values if not already present
        await conn.execute(`
            INSERT IGNORE INTO worker_config (\`key\`, value) VALUES
                ('toggle_mode', 'AUTO'),
                ('tunnel_url',  ''),
                ('api_key',     '')
        `);

        console.log("[DB] Worker database initialized");

    } finally {
        conn.release();
    }
}

// ── Config helpers ────────────────────────────────────────────────────────────

export async function getConfig(key: string): Promise<string | null> {
    const conn = await pool.getConnection();
    try {
        const [rows] = await conn.execute<any[]>(
            "SELECT value FROM worker_config WHERE `key` = ? LIMIT 1",
            [key]
        );
        return rows[0]?.value ?? null;
    } finally {
        conn.release();
    }
}

export async function setConfig(key: string, value: string): Promise<void> {
    const conn = await pool.getConnection();
    try {
        await conn.execute(
            "INSERT INTO worker_config (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
            [key, value]
        );
    } finally {
        conn.release();
    }
}
