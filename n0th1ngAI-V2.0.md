# n0th1ng AI V2.0 — Security Hardening & Workstation Gate Progress Log

> **Workstation Security & Architecture Tracking**  
> **Target Deployments**: Local Workstation (`http://localhost:3000`) & Oracle Cloud Infrastructure (OCI Public HTTPS Domain)  
> **Core Principle**: Strictly single-user terminal gatekeeper. Zero multi-tenant bloat, zero per-row tenancy rewrites. Identical behavior locally and in cloud production (behavior changes strictly via environment variables, never hardcoded `isProd`).

---

## Master Checklist & Progress

- [x] **Phase 0 — Database Schema**
- [x] **Phase 1 — Core Gate (Password Only & Session Hardening)**
- [x] **Phase 2 — Worker Authentication (Cluster Ingestion Lockdown)**
- [x] **Phase 3 — TOTP: Time Drift & Replay Protection**
- [x] **Phase 4 — Device Trust + Quick PIN Unlock**
- [x] **Phase 5 — WebAuthn / Passkeys (Touch ID, Windows Hello, YubiKey)**
- [x] **Phase 6 — Tiered Trust: Forge / ForgeX Execution Gate**
- [x] **Phase 7 — Cloudflare Access Outer Perimeter Integration**
- [x] **Phase 8 — Production Hardening & Reverse Proxy Pass**

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

## Phase 3 — TOTP: Time Drift & Replay Protection (Completed)

### Summary & Technical Decisions
- **Standard Library Choice**:
  - Implemented RFC 6238 HMAC-SHA1 TOTP generation and verification via `speakeasy` and QR code generation via `qrcode`.
- **Secret Encryption at Rest**:
  - All shared TOTP secrets are encrypted at rest in `auth_totp_secrets.secret` via AES-256-GCM using `APP_SECRET` derived keys (`iv.authTag.ciphertext`).
- **Clock Drift Tolerance**:
  - Bounded strictly to `window: 1` (current step ± 1, allowing 90 seconds total window tolerance). Rejects wide/arbitrary window scans.
- **Time Step Tracking & Replay Protection**:
  - Added `lastVerifiedStep` (`bigint`, nullable) column to `auth_totp_secrets` schema and applied migration.
  - Calculated `matchedStep = currentStep + delta`. If `lastVerifiedStep != null && matchedStep <= lastVerifiedStep`, rejected with `"code_already_used"`.
  - Blocks replay within the validity window and prevents re-using enrollment codes for subsequent logins.
- **Pending-Token Intermediate State**:
  - When password is verified and TOTP is enabled, `createSession()` is NOT called yet.
  - A single-purpose 32-byte opaque random token is stored in memory (`pendingTotpStore`) with strict 5-minute TTL.
  - Pending tokens are completely isolated from session verification (`verifySession()` will never accept them).
  - Only `/api/auth/totp/verify-login` consumes this token to mint a real session with `methodUsed: "totp"`.
- **Unified Rate Limiting**:
  - Reused `checkRateLimit` and `recordRateLimitFailure` (5 attempts / 10 min, progressive delay on attempts 3–4, 15 min lockout) on `/api/auth/totp/verify` and `/api/auth/totp/verify-login`.
- **Protected Operator Endpoints (`api/routers/auth.router.ts`)**:
  - `POST /api/auth/totp/verify-login`: Consumes pending token + 6-digit code, enforces drift & replay protection, mints session.
  - `GET /api/auth/totp/status`: Requires active operator session, returns whether 2FA is currently enabled.
  - `POST /api/auth/totp/enroll`: Requires active session, generates secret & returns QR data URL and otpauth URI.
  - `POST /api/auth/totp/verify`: Requires active session, verifies initial code and enables 2FA.
  - `POST /api/auth/totp/disable`: Requires active session and password confirmation, revokes 2FA.
- **Frontend Integration (`frontend/login/index.html` & `frontend/login/login.js`)**:
  - Built dedicated TOTP verification UI with auto-submission on 6 digits.
  - Added visual error shaking, countdown timers on rate-limiting (429), session timeout fallback (410), and back-to-password toggle.
  - Forwarded legacy `login.html` and navbar redirects to `/frontend/login/`.
- **Automated Verification**:
  - Built regression test script `scripts/test-phase3-totp.ts` covering encryption round-trips, window drift, replay rejection, cross-step replaying, and database enrollment/verification.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `db/schema.ts` | Modified | Added `lastVerifiedStep` column to `auth_totp_secrets`. |
| `api/services/auth.service.ts` | Modified | Added AES-256-GCM secret encryption, pending token lifecycle, `speakeasy` TOTP verification with replay rejection, and enrollment/login methods. |
| `api/routers/auth.router.ts` | Modified | Added `/totp/verify-login`, `/totp/status`, `/totp/enroll`, `/totp/verify`, `/totp/disable`, and updated `/login` to return `totpRequired: true` + `pendingToken`. |
| `api/boot.ts` | Modified | Updated 302 unauthenticated redirects to `/frontend/login/?returnTo=...`. |
| `frontend/login/index.html` | Modified | Injected TOTP 6-digit input form and action buttons. |
| `frontend/login/login.js` | Modified | Added TOTP view switching, input validation, auto-submit on 6 digits, rate limit countdowns, and session expiration handling. |
| `frontend/assets/nav.js` | Modified | Updated lock/logout buttons and 401 interceptor redirect targets to `/frontend/login/`. |
| `login.html` | Modified | Forwarding stub directing any legacy accesses to `/frontend/login/`. |
| `package.json` | Modified | Added `speakeasy`, `qrcode`, and `@types/qrcode`. |
| `scripts/test-phase3-totp.ts` | Created | Standalone test script validating TOTP encryption, replay protection, and DB enrollment. |

---

## Phase 4 — Device Trust + Quick PIN Unlock (Completed)

### Summary & Technical Decisions
- **Device Trust Model & Cookie Isolation**:
  - Device trust pairs the operator's machine after a successful full credential login (password[+TOTP] or passkey).
  - Emits a 32-byte opaque random token signed with `APP_SECRET` (HMAC-SHA256) into a separate, long-lived `HttpOnly` cookie (`n0th1ng_device_trust`), completely detached from the short-lived `n0th1ng_session` cookie.
  - Logging out or locking the workstation clears the session cookie while keeping device trust intact.
- **Quick PIN Architecture**:
  - PINs (4–8 digits) are hashed with Argon2id and stored exclusively within the matching `device_trust` record.
  - PIN unlock (`POST /api/auth/pin/unlock`) only functions when a valid, unexpired `n0th1ng_device_trust` cookie is provided.
  - PIN can **never** authenticate alone or act as a standalone login without an existing trusted device row.
- **Tiered Scope Protection**:
  - Sessions issued via PIN unlock are strictly minted with `methodUsed: "pin"` and `scope: "standard"`.
  - PIN-derived sessions **cannot** escalate to `forge_unlocked` without re-authenticating via full password, TOTP, or passkey.
- **Brute-Force & Rate Limiting**:
  - Protected the 4–8 digit PIN space using the central rate limiter (5 failed attempts per 10 minutes per IP, progressive delays, and 15-minute lockout).
- **Auto-Lock on Inactivity**:
  - Added an idle activity monitor in `frontend/assets/nav.js` listening to mouse, keyboard, touch, and scroll interactions.
  - After 15 minutes of inactivity or system sleep, automatically terminates the session via `POST /api/auth/logout` and redirects to `/frontend/login/?idle=true&returnTo=...`.
- **Frontend Integration**:
  - `frontend/login/index.html` & `frontend/login/login.js`:
    - Checks `/api/auth/device-trust/status` on load.
    - If device is trusted and has a PIN configured, switches automatically to the Quick PIN form.
    - Added option to toggle between PIN unlock and master password unlock.
    - Enabled optional quick PIN provisioning when "Remember this device" is checked on the password form.
- **Automated Verification**:
  - Built regression test script `scripts/test-phase4-pin.ts` verifying token signing & tampering detection, Argon2id PIN hashing, positive & negative PIN checks, scope isolation (`standard`), PIN updates, and device trust revocation.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/auth.service.ts` | Modified | Added device trust token signing, verification, Argon2id PIN hashing, `verifyDevicePin`, `setDevicePin`, and trust revocation. |
| `api/routers/auth.router.ts` | Modified | Added `/device-trust/status`, `/device-trust/setup`, `/device-trust/revoke`, and `/pin/unlock` endpoints; updated `/login` and `/totp/verify-login` to accept device trust & PIN. |
| `frontend/assets/nav.js` | Modified | Added 15-minute inactivity auto-lock and suspended state detector. |
| `frontend/login/index.html` | Modified | Injected quick PIN unlock form and optional PIN setup row. |
| `frontend/login/login.js` | Modified | Added PIN view handling, input validation, auto-detection of trusted device status, and unlock submission. |
| `scripts/test-phase4-pin.ts` | Created | Standalone test script validating token tampering protection, Argon2id PIN verification, and session scope enforcement. |

---

## Phase 5 — WebAuthn / Passkeys (Windows Hello, Touch ID, Android, iOS, YubiKey) (Completed)

### Summary & Technical Decisions
- **Standard Library Choice**:
  - Adopted audited, zero-dependency `@simplewebauthn/server` and `@simplewebauthn/browser` (v14.x) adhering to the FIDO2 / WebAuthn Level 3 specification.
- **Dynamic Relying Party (RP) & Origin Resolution**:
  - Implemented `getWebAuthnConfig(req)` in `api/services/auth.service.ts`:
    - Reads `x-forwarded-host`, `host`, and request URL to dynamically resolve `rpID` and `expectedOrigins` (supporting `localhost:3000`, `127.0.0.1:3000`, and production cloud domains).
    - Can be optionally overridden via `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` in `.env` without any code branching.
- **In-Memory Challenge Lifecycle & Replay Protection**:
  - Opaque random cryptographic challenges are recorded in `webAuthnChallengeStore` with a 5-minute hard TTL.
  - Challenges are verified for action type (`registration` vs `authentication`) and atomically consumed on verification, completely eliminating replay vectors.
- **Passkey Registration Flow**:
  - `POST /api/auth/webauthn/register-options`: Requires an active operator session. Excludes all currently registered credentials (`excludeCredentials`) so the same authenticator is not registered redundantly.
  - `POST /api/auth/webauthn/register-verify`: Verifies attestation, derives base64url-encoded public key, and inserts record into `auth_webauthn_credentials`.
- **Passkey Authentication Flow**:
  - `POST /api/auth/webauthn/login-options`: Public, rate-limited endpoint returning allowed credential IDs.
  - `POST /api/auth/webauthn/login-verify`: Verifies WebAuthn assertion signature against stored public key, validates counter increments, and records `lastUsedAt`.
  - On verification success, mints an operator session with `methodUsed: "passkey"`, `scope: "standard"`, and issues `n0th1ng_session` cookie for 30 days.
- **Passkey Management & Status Endpoints**:
  - `GET /api/auth/webauthn/status`: Public endpoint returning `{ available: boolean }`.
  - `GET /api/auth/webauthn/credentials`: Protected operator endpoint listing all active registered passkeys (ID, deviceLabel, createdAt, lastUsedAt).
  - `DELETE /api/auth/webauthn/credentials/:id`: Protected operator endpoint to revoke and delete a passkey.
- **Frontend Integration (`frontend/login/index.html` & `frontend/login/login.js`)**:
  - Converted `login.js` to ES module (`<script type="module" src="login.js"></script>`).
  - Added dedicated "Sign in with Passkey" glassmorphic button to both master password and quick PIN unlock screens.
  - Dynamically detects passkey availability via `/api/auth/webauthn/status` on page load.
  - Invokes `startAuthentication` from `@simplewebauthn/browser` on click, handles user cancellations/timeouts (`NotAllowedError`) without UI deadlock, and seamlessly redirects on success.
- **Automated Verification**:
  - Built regression test script `scripts/test-phase5-webauthn.ts` verifying dynamic host/origin resolution, challenge store replay prevention, registration options generation, credential lifecycle (insertion, listing, authentication allowance, deletion), and HTTP authorization guards (100% passing).

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/auth.service.ts` | Modified | Added WebAuthn config generator, challenge store, registration options/verification, login options/verification, and credential CRUD methods. |
| `api/routers/auth.router.ts` | Modified | Exposed `/webauthn/status`, `/webauthn/login-options`, `/webauthn/login-verify`, `/webauthn/register-options`, `/webauthn/register-verify`, and `/webauthn/credentials` endpoints. |
| `frontend/login/index.html` | Modified | Updated script to `type="module"`, injected passkey sign-in buttons into password and PIN forms. |
| `frontend/login/login.js` | Modified | Added passkey status checking, dynamic button visibility, and WebAuthn browser authentication handler with ripple success. |
| `package.json` | Modified | Installed `@simplewebauthn/server` and `@simplewebauthn/browser`. |
| `scripts/test-phase5-webauthn.ts` | Created | Automated test script validating WebAuthn challenge lifecycle, database storage, and router endpoints. |

---

## Phase 6 — Tiered Trust: Forge / ForgeX Execution Gate (Completed)

### Summary & Technical Decisions
- **Execution vs Standard Scope Isolation**:
  - Full authentications (Master Password, TOTP, WebAuthn Passkeys) mint sessions with `scope: "forge_unlocked"`.
  - Quick PIN unlocks on trusted devices strictly mint sessions with `scope: "standard"`.
  - Sessions with `scope: "standard"` can read logs, list models, inspect session rails, and chat with AI assistants, but cannot initiate arbitrary subprocesses, docker commands, or autonomous build agents.
- **tRPC Elevation Gate (`api/middleware.ts` & `api/context.ts`)**:
  - Extended tRPC context creation (`createContext`) to verify incoming session cookies and attach the active `session` object to `ctx`.
  - Exported `elevatedForgeProcedure`:
    - Rejects unauthenticated calls with `UNAUTHORIZED`.
    - Rejects `standard` sessions with `FORBIDDEN` and message `"ELEVATION_REQUIRED"`.
  - Gated high-privilege execution endpoints:
    - `forge.create`: autonomous multi-task agentic build loop.
    - `forge.resume`: resumption of paused container tasks.
    - `forge.followUp`: manual agent task additions.
    - `forge.writeFileManually`: direct workspace filesystem writes.
    - `forgex.create`: Claude Code CLI subprocess execution.
    - `forgex.sendInput`: stdin command piping to running subprocess.
    - `runtime.python.start` & `runtime.python.stop`: Python runtime lifecycle controls.
- **30-Minute Inactivity Auto-Demotion (`api/services/auth.service.ts`)**:
  - Added idle monitoring in `verifySession`: if an elevated session (`forge_unlocked`) has been idle for more than 30 minutes (`now - lastSeenAt > 30 * 60 * 1000`), it is automatically demoted to `scope = "standard"` both in-memory and persisted into the database.
- **Step-Up Elevation & Explicit Demotion Endpoints (`api/routers/auth.router.ts`)**:
  - `POST /api/auth/elevate`: Step-up re-authentication endpoint for active sessions. Accepts Master Password (`password`), TOTP 6-digit code (`code`), or WebAuthn assertion (`assertion`). On success, elevates session in the database to `scope: "forge_unlocked"`.
  - `POST /api/auth/demote`: Explicit operator demotion endpoint, dropping the active session back to `scope: "standard"`.
- **Frontend Step-Up UI Integration (`frontend/assets/nav.js`)**:
  - Injected an interactive Forge Trust Pill into the global navigation bar (`⚡ Forge Unlocked` with green indicator or `🔒 Forge Locked` with amber indicator).
  - Clicking `⚡ Forge Unlocked` offers 1-click demotion ("Lock Forge").
  - Clicking `🔒 Forge Locked` triggers the Step-Up Elevation Modal.
  - Upgraded global `fetch` interceptor: any API or tRPC response returning HTTP 403 or `"ELEVATION_REQUIRED"` automatically triggers the glassmorphic Step-Up Elevation Modal with password input and one-click Passkey elevation.
- **Automated Verification**:
  - Built regression test script `scripts/test-phase6-tiered-trust.ts` testing initial scopes, tRPC gate blocking, password elevation, elevated execution pass, explicit demotion, and 30-minute idle auto-demotion (100% passing).

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/auth.service.ts` | Modified | Added 30-minute idle auto-demotion in `verifySession`, exported `elevateSession` and `demoteSession`. |
| `api/context.ts` | Modified | Attached verified session to `TrpcContext`. |
| `api/middleware.ts` | Modified | Exported `elevatedForgeProcedure` enforcing `forge_unlocked` scope. |
| `api/forge/router.ts` | Modified | Protected `create`, `resume`, `followUp`, and `writeFileManually` with `elevatedForgeProcedure`. |
| `api/forgex/router.ts` | Modified | Protected `create` and `sendInput` with `elevatedForgeProcedure`. |
| `api/routers/runtime.ts` | Modified | Protected Python runtime `start` and `stop` with `elevatedForgeProcedure`. |
| `api/routers/auth.router.ts` | Modified | Updated initial scopes (setup/login/totp/passkey grant `forge_unlocked`), added `POST /elevate` and `POST /demote`. |
| `frontend/assets/nav.js` | Modified | Added Forge trust status pill, Step-Up elevation modal, and global `ELEVATION_REQUIRED` response interception. |
| `scripts/test-phase6-tiered-trust.ts` | Created | Automated test script validating scope enforcement, elevation, and idle demotion. |

---

## Phase 7 — Cloudflare Access Outer Perimeter Integration (Completed)

### Summary & Technical Decisions
- **Zero-Dependency Native RS256 Verification (`api/services/cloudflare.service.ts`)**:
  - Implemented pure Node `crypto` RS256 JWK verification via `crypto.createPublicKey({ key: jwk, format: "jwk" })` and `crypto.verify("RSA-SHA256", ...)`.
  - Zero third-party JWT dependencies required, eliminating supply chain risk.
  - Automatically fetches and caches public signing keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` with a 1-hour TTL and request rate-limiting.
  - Pinned test key support (`setCachedCloudflareKeys`) protects offline test suites from outbound network latency or live key collisions.
- **Team Domain Normalization**:
  - `normalizeTeamDomain` handles raw names (`myteam`), full URLs (`https://myteam.cloudflareaccess.com`), trailing slashes, and uppercase variations into standard canonical URLs.
- **Outer Perimeter Enforcement & Local Dev Passthrough**:
  - If `CF_ACCESS_REQUIRED=true` (or `CF_ACCESS_ENFORCED=true`), all unauthenticated requests without a verified assertion or valid service token are rejected at the edge with HTTP 403 `{"error": "Cloudflare Access verification required"}`.
  - On local development (`http://localhost:3000`) where `CF_ACCESS_REQUIRED` is unset and no assertion is passed, requests pass through seamlessly to inner gatekeeper authentication.
  - If a Cloudflare assertion is presented even during local testing, it must be cryptographically valid (valid signature, unexpired, non-tampered, matching `AUD` / `ISS`).
- **Assertion Extraction & Service Tokens**:
  - Extracts tokens from both `Cf-Access-Jwt-Assertion` header and `CF_Authorization` cookie.
  - Validates Cloudflare Service Tokens (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) using constant-time `crypto.timingSafeEqual`.
  - Automated worker / cluster requests presenting valid Cloudflare Service Tokens or assertions with `identity_type: "service"` automatically inherit worker lane privileges (`isWorker = true`).
- **Gatekeeper Middleware Mounting (`api/boot.ts`)**:
  - Placed `evaluateCloudflareAccess` at the outermost middleware boundary before session parsing or worker token verification.
- **Outer Perimeter Status Endpoint (`api/routers/auth.router.ts`)**:
  - Added `GET /api/auth/cloudflare/status` reporting configuration state (`configured`, `teamDomain`, `required`, `tokenPresent`, `identityType`, `email`).
- **Automated Verification**:
  - Created standalone test suite `scripts/test-phase7-cloudflare.ts` validating domain normalization, local dev passthrough, cryptographic RS256 key generation, JWK export, signature verification, negative security checks, extraction, and outer perimeter enforcement (100% passing).

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/cloudflare.service.ts` | Created | Native Node RS256 JWK verification, certs caching, domain normalization, perimeter evaluation, and service token validation. |
| `api/boot.ts` | Modified | Mounted outer perimeter `evaluateCloudflareAccess` middleware before inner session/worker gates. |
| `api/routers/auth.router.ts` | Modified | Added `GET /cloudflare/status` diagnostic and telemetry endpoint. |
| `scripts/test-phase7-cloudflare.ts` | Created | Standalone test suite covering RS256 verification, negative security checks, extraction, and outer perimeter enforcement. |

---

## Phase 8 — Production Hardening & Reverse Proxy Pass (Completed)

### Summary & Technical Decisions
- **CSRF Defense-in-Depth (`api/services/security.service.ts`)**:
  - Combined `SameSite=Lax` cookies with strict Fetch Metadata request inspection (`Sec-Fetch-Site`).
  - For all state-changing HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`), any request flagged with `Sec-Fetch-Site: cross-site` is immediately aborted with HTTP 403 `{"error": "CSRF_DETECTED", "message": "Cross-site request rejected."}`.
  - Performs `Origin` and `Referer` validation against dynamically derived allowed hostnames (`localhost:3000`, `127.0.0.1:3000`, forwarded host via `x-forwarded-host`, and environment overrides `ALLOWED_ORIGINS` / `WEBAUTHN_ORIGIN`).
  - Non-browser machine worker lane requests (authenticated via `Authorization: Bearer <key>`, `X-Workstation-Key`, or Cloudflare Service Tokens) and safe idempotent read methods (`GET`, `HEAD`, `OPTIONS`) are cleanly exempted.
- **HTTP Security Response Headers**:
  - Attached standard production security headers across all gatekeeper responses:
    - `X-Content-Type-Options: nosniff`: Prevents MIME-sniffing vulnerabilities.
    - `X-Frame-Options: DENY`: Prevents UI redressing and clickjacking attacks.
    - `Referrer-Policy: strict-origin-when-cross-origin`: Restricts outbound referer leakage.
    - `X-XSS-Protection: 1; mode=block`: Legacy browser cross-site scripting filter.
    - `Strict-Transport-Security: max-age=31536000; includeSubDomains`: Conditionally applied when requested over HTTPS or behind an SSL-terminating reverse proxy (`x-forwarded-proto: https`).
- **Endpoint Security Audit**:
  - Verified static asset filtering (`isSafeStaticAsset`) ensuring `frontend/assets/` only serves public image, style, script, and font extensions, eliminating accidental directory browsing or data disclosure.
  - Audited all API and tRPC routes in `boot.ts`: every route is strictly mounted downstream of the gatekeeper middleware.
- **Automated Verification**:
  - Created standalone test suite `scripts/test-phase8-hardening.ts` verifying:
    - Dynamic allowed origins resolution for local dev and cloud proxies.
    - `Sec-Fetch-Site` cross-site rejection and same-origin acceptance.
    - Origin / Referer header validation and imposter spoofing defense.
    - Safe HTTP methods and machine worker exemptions.
    - Conditional HSTS and security header enforcement.
    - Live gatekeeper middleware integration with HTTP 403 `CSRF_DETECTED` blocking on `/api/auth/login`.
  - Result: 100% test pass rate.

### Files Changed / Created
| File Path (Relative to `app/`) | Action | Purpose |
| :--- | :--- | :--- |
| `api/services/security.service.ts` | Created | Central CSRF validator (`validateCsrfProtection`), dynamic origin resolver (`getAllowedOrigins`), and security header injector (`applySecurityHeaders`). |
| `api/boot.ts` | Modified | Integrated CSRF verification and security response headers into gatekeeper middleware; ensured `app.route("/api/auth", authRouter)` is protected. |
| `scripts/test-phase8-hardening.ts` | Created | Automated test script validating CSRF blocking, worker lane bypass, and security response headers. |

---

## Production Deployment & Reverse Proxy Architecture (Oracle Cloud VM)

### Defense-in-Depth Pipeline
```text
[Operator Browser / Authenticator]
                 │
                 ▼
     [Cloudflare Access / Tunnel]  <-- (Phase 7: Outer Perimeter RS256 JWK Verification)
                 │
                 ▼
         [Caddy Reverse Proxy]     <-- (Phase 8: TLS Termination & Reverse Proxy)
         (127.0.0.1:3000)
                 │
                 ▼
     [n0th1ng AI Gatekeeper]       <-- (Phase 1, 3, 4, 5, 8: CSRF, Master Password, TOTP, PIN, Passkey)
                 │
                 ▼
       [Execution Gatekeeper]      <-- (Phase 6: Tiered Trust `forge_unlocked` for Forge / ForgeX)
```

### Recommended Caddyfile (`/etc/caddy/Caddyfile`)
```caddy
# Production Oracle Cloud VM Domain
ai.yourdomain.com {
    # Reverse proxy to local n0th1ng AI workstation
    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}

        # WebSocket / SSE support for live terminal and chat streaming
        flush_interval -1
    }

    # Reinforced Transport Security
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }

    # Access Logging
    log {
        output file /var/log/caddy/n0th1ng-access.log {
            roll_size 20MB
            roll_keep 5
        }
    }
}
```

### Production Systemd Service (`/etc/systemd/system/n0th1ng-ai.service`)
```ini
[Unit]
Description=n0th1ng AI Workstation Server
After=network.target mysql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/n0th1ng-ai/app
EnvironmentFile=/opt/n0th1ng-ai/app/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

---

## Complete Verification Test Suite Summary

Every phase has an automated, standalone regression test suite in `scripts/`:

| Phase | Test Script | Verified Capabilities | Status |
| :--- | :--- | :--- | :--- |
| **Phase 3** | `scripts/test-phase3-totp.ts` | AES-256-GCM secret encryption, pending token lifecycle, window=1 drift, RFC 6238 time-step replay prevention. | **PASSED** (100%) |
| **Phase 4** | `scripts/test-phase4-pin.ts` | HMAC-SHA256 cookie signing, Argon2id PIN hashing, trusted device pairing, `standard` scope isolation. | **PASSED** (100%) |
| **Phase 5** | `scripts/test-phase5-webauthn.ts` | WebAuthn dynamic origin resolution, single-use challenges, registration/authentication options, credential CRUD. | **PASSED** (100%) |
| **Phase 6** | `scripts/test-phase6-tiered-trust.ts` | Initial scope assignment, tRPC elevation gate on Forge/ForgeX, Step-Up elevation, 30-min idle auto-demotion. | **PASSED** (100%) |
| **Phase 7** | `scripts/test-phase7-cloudflare.ts` | Team domain normalization, local dev passthrough, native RS256 JWK verification, negative security checks, service tokens. | **PASSED** (100%) |
| **Phase 8** | `scripts/test-phase8-hardening.ts` | CSRF `Sec-Fetch-Site` inspection, origin matching, machine worker bypass, nosniff, DENY, and conditional HSTS. | **PASSED** (100%) |

---

## 2AM Emergency Recovery Runbook (SSH + CLI)

If you are ever locked out of the workstation (forgotten master password, lost or broken 2FA phone, lost WebAuthn security key, or session deadlock):

1. **SSH into the Server / Oracle Cloud VM**:
   ```bash
   ssh -i ~/.ssh/id_rsa ubuntu@your-vm-ip
   cd /opt/n0th1ng-ai/app
   ```

2. **Run the Auth Recovery CLI**:
   ```bash
   npm run auth:reset
   ```
   - Enter a new master password (min 8 characters), or press Enter to auto-generate a secure random password.
   - If TOTP second-factor is enabled and you lost your authenticator device, confirm with `y` to immediately disable TOTP.
   - The tool atomically:
     - Re-hashes the new password with Argon2id and writes it to `auth_credentials`.
     - Revokes all existing active sessions in `sessions`.
     - Disables TOTP in `auth_totp_secrets` (if requested).

3. **Non-Interactive Command Line Execution**:
   ```bash
   npx tsx scripts/reset-auth.ts --password="YourNewSecurePassword123" --reset-totp
   ```

4. **Machine Worker Key Administration**:
   ```bash
   npm run worker:keys
   ```
   Manage headless worker tokens, list active workers, or revoke compromised cluster API keys.




