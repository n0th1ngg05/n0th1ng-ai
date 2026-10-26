# n0th1ng AI V2.0 — Security Hardening & Workstation Gate Progress Log

> **Workstation Security & Architecture Tracking**  
> **Target Deployments**: Local Workstation (`http://localhost:3000`) & Oracle Cloud Infrastructure (OCI Public HTTPS Domain)  
> **Core Principle**: Strictly single-user terminal gatekeeper. Zero multi-tenant bloat, zero per-row tenancy rewrites. Identical behavior locally and in cloud production (behavior changes strictly via environment variables, never hardcoded `isProd`).

---

## Master Checklist & Progress

- [x] **Phase 0 — Database Schema**
- [x] **Phase 1 — Core Gate (Password Only & Session Hardening)**
- [x] **Phase 2 — Worker Authentication (Cluster Ingestion Lockdown)**
- [ ] **Phase 3 — TOTP (Second Factor on Untrusted Devices)**
- [ ] **Phase 4 — Device Trust + Quick PIN Unlock**
- [ ] **Phase 5 — WebAuthn / Passkeys (Touch ID, Windows Hello, YubiKey)**
- [ ] **Phase 6 — Tiered Trust: Forge / ForgeX Execution Gate**
- [ ] **Phase 7 — Cloudflare Access Outer Perimeter Integration**
- [ ] **Phase 8 — Production Hardening & Reverse Proxy Pass**

---

## Phase 0 — Database Schema (Completed)

### Summary & Technical Decisions
- Preserved existing `users` table shape without introducing multi-tenant baggage.
- Created 7 dedicated security tables in MySQL to support single-operator credentials, encrypted TOTP secrets, WebAuthn keys, instant-revocation sessions, cookie-bound device trust, formalized worker keys, and an immutable security audit trail.
- Confirmed `APP_SECRET` in `api/lib/env.ts` as the sole session-signing key.
- Created and executed a dedicated migration runner (`scripts/migrate-auth.ts`) using raw DDL to avoid `drizzle-kit push` destructive schema alters on existing tables.

### Tables Added
1. `auth_credentials`: Single-row table storing the Argon2id master password hash.
2. `auth_totp_secrets`: Stores RFC 6238 TOTP secrets (encrypted at rest via `APP_SECRET` AES-256-GCM).
3. `auth_webauthn_credentials`: Registry of registered WebAuthn / FIDO2 passkeys.
4. `sessions`: Opaque 64-character random tokens looked up on every request for instantaneous revocation.
5. `device_trust`: Long-lived cookie-bound token pairing trusted devices for PIN-based unlock.
6. `worker_api_keys`: Formalized registry of hashed pre-shared keys for cluster & background workers.
7. `auth_audit_log`: Security audit trail capturing method, success/failure, IP, User-Agent, and failure reasons.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `db/schema.ts` | Modified | Added 7 new authentication & security tables. |
| `package.json` | Modified | Added `argon2` dependency for password & PIN hashing. |
| `scripts/migrate-auth.ts` | Created | Standalone DDL migration runner to verify and create Phase 0 tables safely. |

---

## Phase 1 — Core Gate: Password Only & Session Hardening (Completed)

### Summary & Technical Decisions
- **Central Auth Service (`api/services/auth.service.ts`)**:
  - Implemented Argon2id password hashing with default memory-hard settings (`64 MB`, `timeCost: 3`, `parallelism: 1`), fully tunable via environment variables (`ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`).
  - Implemented opaque random session tokens (`crypto.randomBytes(32)`), signed with `APP_SECRET` using HMAC-SHA256. Verified in constant time via `crypto.timingSafeEqual`.
  - Added session expiration and revocation helpers (`revokeSession`, `revokeAllSessions`).
  - Added in-memory rate limiter: maximum 5 attempts per 10-minute window per IP, progressive delays (2.5s) on attempts 3–4, and mandatory 15-minute lockout on attempt 5.
  - Added audit logger recording every login, logout, setup, and failure attempt into `auth_audit_log`.
- **Auth HTTP Endpoints (`api/routers/auth.router.ts`)**:
  - `GET /api/auth/status`: Informs frontend whether the workstation master password is initialized.
  - `POST /api/auth/setup`: First-run initialization route (permanently disabled once a password is set).
  - `POST /api/auth/login`: Verifies master password, handles rate limits, logs audit, and sets `HttpOnly` session cookie.
  - `POST /api/auth/logout`: Revokes database session and clears cookie.
  - `GET /api/auth/me`: Verifies active session token.
- **Zero-Trust Gatekeeper Middleware (`api/boot.ts`)**:
  - Mounted before all routes and body parsers.
  - **Public Whitelist**: `/login.html`, `/frontend/login/*`, `/frontend/assets/*`, `/api/auth/*`, and Vite dev internals (`/@*`).
  - **Worker Lane**: Inspects `Authorization: Bearer <key>` or `X-Workstation-Key` and bypasses human session checks for authorized machine clients.
  - **Human Session Lane**: Inspects `n0th1ng_session` cookie. Dynamic `Secure` flag via `x-forwarded-proto` or HTTPS (never hardcoded `if (isProd)`).
  - **Unauthenticated Handling**: Browser requests (`text/html`) 302 redirect to `/login.html?returnTo=...`; API/tRPC requests return HTTP 401 JSON.
- **Break-Glass CLI Recovery (`scripts/reset-auth.ts`)**:
  - Shell-only script to reset the master password or revoke all sessions via command-line arguments (`--password="..."`) or interactive prompt.
- **UI Integration**:
  - `login.html`: Baseline aurora glassmorphic login and setup screen.
  - `frontend/assets/nav.js`: Injected Lock button into global navbar and mobile drawer to clear sessions and return to the lock screen on demand. Added global `401 AUTH_REQUIRED` fetch interceptor to automatically redirect expired sessions to `/login.html` with `returnTo`.
  - `api/boot.ts`: Whitelist for `/frontend/assets/*` strictly hardened with extension regex (`css|js|png|jpg|jpeg|svg|ico|woff2|webp|map`) to prevent any unauthenticated bypass of non-asset files.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/auth.service.ts` | Created | Central auth service: Argon2id hashing, session lifecycle, rate limiting, and audit logging. |
| `api/routers/auth.router.ts` | Created | Hono HTTP router exposing `/status`, `/setup`, `/login`, `/logout`, and `/me`. |
| `api/boot.ts` | Modified | Mounted auth router, tightened static asset whitelist, and zero-trust gatekeeper middleware ahead of all routes. |
| `frontend/assets/nav.js` | Modified | Injected lock/logout button into global navbar, mobile drawer, and global 401 fetch interceptor. |
| `login.html` | Created | Aurora-themed login and setup UI. |
| `frontend/login/index.html` | Created | Redirect stub ensuring `/frontend/login` forwards to `/login.html`. |
| `scripts/reset-auth.ts` | Created | CLI break-glass recovery tool to set/reset master password via terminal. |

---

## Phase 2 — Worker Authentication (Cluster Ingestion Lockdown) (Completed)

### Summary & Technical Decisions
- **Cluster Ingestion Lockdown (`api/boot.ts`)**:
  - `POST /api/cluster/register`: Explicitly restricted to authenticated workers (`isWorker === true`). Rejects unauthenticated callers or sessions without a valid worker key with HTTP 401.
  - `POST /api/cluster/heartbeat`: Restricted to authenticated workers (`isWorker === true`). Rejects unauthenticated heartbeat/stat injections with HTTP 401.
  - `GET /api/cluster/:id/logs/stream`: Inbound proxy strictly requires an active operator human session (`session` in context). Worker keys or unauthenticated clients cannot read worker log streams.
- **Worker Key Hashing & Verification (`api/services/auth.service.ts`)**:
  - Validates `Authorization: Bearer <key>` or `X-Workstation-Key`.
  - Performs constant-time comparison (`crypto.timingSafeEqual`) of SHA-256 hashes against `worker_api_keys` where `revokedAt IS NULL`.
  - Automatically records `lastUsedAt` timestamp upon successful worker verification.
  - Retains backward-compatible fallback to `WORKER_DESKTOP_KEY` in `.env`.
- **Worker Key Management CLI (`scripts/manage-worker-keys.ts`)**:
  - `npm run worker:keys create <label>`: Provisions random `n0th1ng_wk_...` keys, stores SHA-256 hash, and outputs setup snippet for worker `.env`.
  - `npm run worker:keys list`: Displays active/revoked keys, labels, creation dates, and last used timestamps.
  - `npm run worker:keys revoke <id>`: Instantly revokes worker keys in the database.
- **Convenience NPM Scripts (`package.json`)**:
  - Added `"worker:keys": "tsx scripts/manage-worker-keys.ts"` and `"auth:reset": "tsx scripts/reset-auth.ts"`.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/auth.service.ts` | Modified | Added `createWorkerApiKey`, `listWorkerApiKeys`, `revokeWorkerApiKey`, and enhanced hash verification. |
| `api/boot.ts` | Modified | Enforced `isWorker` on `/api/cluster/register` and `/api/cluster/heartbeat`; enforced `session` on `/logs/stream`. |
| `scripts/manage-worker-keys.ts` | Created | Operator CLI for provisioning, listing, and revoking cluster worker keys. |
| `package.json` | Modified | Added `"worker:keys"` and `"auth:reset"` command shortcuts. |

---

## Phase 3 — TOTP (Second Factor on Untrusted Devices) — Upcoming

### Target Scope
- Implement standard RFC 6238 TOTP enrollment and verification service.
- Generate TOTP secrets encrypted at rest in `auth_totp_secrets` using `APP_SECRET` (AES-256-GCM).
- `/api/auth/totp/enroll`: Generates secret and returns QR code / otpauth URI for authenticator apps.
- `/api/auth/totp/verify`: Confirms initial code to mark secret verified, or acts as second factor during login.
- Two-step login flow: if TOTP is enabled and device has no valid `device_trust` row &rarr; prompt for 6-digit TOTP code before minting full session.
- Apply strict rate limiting on TOTP verification.

---

## Phase 8 — Production Hardening & Outer Perimeter Notes

- **CSRF & Origin Verification**: Add strict `Sec-Fetch-Site` (`same-origin` / `same-site`) and `Origin` / `Referer` matching for state-changing HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`) to complement `SameSite=Lax` cookies.
- **Caddy Reverse Proxy**: Configure Caddy to bind to 127.0.0.1:3000 and manage TLS certificates.


