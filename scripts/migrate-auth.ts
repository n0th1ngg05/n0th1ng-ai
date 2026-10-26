import { getDbAsync } from "../api/queries/connection";
import { sql } from "drizzle-orm";

const statements = [
  `CREATE TABLE IF NOT EXISTS \`auth_credentials\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`password_hash\` varchar(255) NOT NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT \`auth_credentials_id\` PRIMARY KEY(\`id\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`auth_totp_secrets\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`secret\` text NOT NULL,
    \`verified\` boolean NOT NULL DEFAULT false,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \`auth_totp_secrets_id\` PRIMARY KEY(\`id\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`auth_webauthn_credentials\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`credential_id\` varchar(500) NOT NULL,
    \`public_key\` text NOT NULL,
    \`counter\` bigint NOT NULL DEFAULT 0,
    \`device_label\` varchar(255),
    \`transports\` json,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`last_used_at\` timestamp NULL,
    CONSTRAINT \`auth_webauthn_credentials_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`auth_webauthn_credentials_credential_id_unique\` UNIQUE(\`credential_id\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`sessions\` (
    \`id\` varchar(128) NOT NULL,
    \`device_label\` varchar(255),
    \`method_used\` enum('password','totp','pin','passkey') NOT NULL,
    \`scope\` enum('standard','forge_unlocked') NOT NULL DEFAULT 'standard',
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`last_seen_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`ip_last_seen\` varchar(64),
    \`revoked_at\` timestamp NULL,
    \`expires_at\` timestamp NOT NULL,
    CONSTRAINT \`sessions_id\` PRIMARY KEY(\`id\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`device_trust\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`device_fingerprint\` varchar(255),
    \`token\` varchar(128) NOT NULL,
    \`pin_hash\` varchar(255),
    \`trusted_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`expires_at\` timestamp NOT NULL,
    CONSTRAINT \`device_trust_id\` PRIMARY KEY(\`id\`),
    CONSTRAINT \`device_trust_token_unique\` UNIQUE(\`token\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`worker_api_keys\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`label\` varchar(255) NOT NULL,
    \`key_hash\` varchar(255) NOT NULL,
    \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`revoked_at\` timestamp NULL,
    \`last_used_at\` timestamp NULL,
    CONSTRAINT \`worker_api_keys_id\` PRIMARY KEY(\`id\`)
  );`,

  `CREATE TABLE IF NOT EXISTS \`auth_audit_log\` (
    \`id\` serial AUTO_INCREMENT NOT NULL,
    \`timestamp\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`method\` varchar(50) NOT NULL,
    \`success\` boolean NOT NULL,
    \`ip\` varchar(64),
    \`user_agent\` text,
    \`failure_reason\` text,
    CONSTRAINT \`auth_audit_log_id\` PRIMARY KEY(\`id\`)
  );`
];

async function run() {
  console.log("Applying Phase 0 Auth tables to local MySQL...");
  const db = await getDbAsync();
  for (const stmt of statements) {
    const tableName = stmt.match(/CREATE TABLE IF NOT EXISTS `([^`]+)`/)?.[1] ?? "unknown";
    try {
      await db.execute(sql.raw(stmt));
      console.log(`[OK] Table ${tableName} verified / created.`);
    } catch (err: any) {
      console.error(`[FAIL] Table ${tableName}:`, err.message);
      process.exit(1);
    }
  }
  console.log("All 7 Phase 0 tables are active and ready in MySQL!");
  process.exit(0);
}

run();
