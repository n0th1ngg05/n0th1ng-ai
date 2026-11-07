# n0th1ng AI V2.0 — Personal Intelligence Workstation

> **You Imagine, We Render.**

n0th1ng AI is a fully self-hosted, privacy-first, personal artificial intelligence workstation. It is not a SaaS product, not a subscription service, and not a cloud tool. It is an entire intelligence operating environment that runs on your own hardware — your models, your data, your rules.

Built from the ground up as a unified platform, n0th1ng AI integrates large language models, image generation, cinematic video generation, speech intelligence, autonomous coding agents, document intelligence, real-time system monitoring, a persistent memory system, and distributed GPU cluster nodes — all under one roof, all private, and secured by an enterprise-grade **V2.0 Workstation Gatekeeper**.

---

## What's New in Version 2.0 (V2.0)

Version 2.0 upgrades n0th1ng AI from a purely local prototype to a **cloud-hardened, production-ready workstation** that can be securely deployed both on a local workstation and exposed to the public internet on an Oracle Cloud Infrastructure (OCI) or VPS instance without compromise.

- **Single-Operator Zero-Trust Gatekeeper**: Eliminates multi-tenant SaaS complexity while enforcing ironclad, defense-in-depth security. A single human session primitive handles multiple unlock methods without modifying existing frontend fetch calls.
- **Layered Authentication**:
  - **Master Password**: Memory-hard **Argon2id** password hashing (`64 MB`, `timeCost: 3`, `parallelism: 1`), fully tunable via environment variables.
  - **RFC 6238 TOTP 2FA**: Time-based one-time passwords with secrets encrypted at rest via AES-256-GCM, strict clock drift tolerance (`window: 1`, ±30s), pending-token intermediate states, and atomic database test-and-set queries preventing replay attacks.
  - **Trusted Device Pairing & Quick PIN**: Cryptographically signed `n0th1ng_device_trust` cookies paired with Argon2id-hashed PINs (4–8 digits) for instantaneous unlock on trusted devices.
  - **WebAuthn / Passkeys (FIDO2)**: Hardware-backed biometrics via Windows Hello, Apple Touch ID / Face ID, Android biometrics, and physical YubiKeys via native zero-dependency WebAuthn Level 3.
- **Tiered Trust & Step-Up Elevation**:
  - Dual-tier scopes: `scope: "standard"` (read telemetry, browse, standard chat) vs `scope: "forge_unlocked"` (Forge & ForgeX code execution, shell commands, docker, runtime management).
  - 30-minute idle auto-demotion to protect unattended workstations.
  - Real-time interactive UI elevation modal and 1-click demote toggle in global navbar.
- **Cloudflare Access Outer Perimeter**:
  - Native RS256 JWK verification via pure Node `crypto` (zero third-party JWT dependencies).
  - Validates Cloudflare Access Service Tokens for automated machine communication.
  - Automatic, seamless passthrough for local development.
- **Reverse Proxy & Hardened HTTP Transport**:
  - Fetch Metadata `Sec-Fetch-Site: cross-site` CSRF blocking on all state-changing endpoints.
  - Strict HTTP security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, conditional `HSTS`).
  - Production-ready Caddy reverse proxy profile with full SSE and WebSocket streaming support.
- **Hardened Distributed GPU Workers**:
  - Worker Exposure Gateway running an authenticated proxy on port `3443` in front of raw worker port `3001`.
  - Constant-time comparison (`crypto.timingSafeEqual`) and default placeholder rejection.
  - Optional database connection resilience (workers boot and authenticate cleanly even in DB-less environments).
  - Operator CLI for worker key provisioning and revocation (`npm run worker:keys`).
- **2AM Break-Glass CLI Recovery**:
  - Shell-only recovery tool (`npm run auth:reset` / `scripts/reset-auth.ts`) allowing instant password resets, session revocation, and 2FA lockout bypass over SSH.
- **Sub-Second TTFT Engine (<50ms Response) & Live SSE Pipeline**:
  - **Tier 0 Intent Classifier (`api/services/intentClassifier.ts`)**: Pre-classifies user prompts in <1ms without LLM prefill across `GREETING`, `CASUAL`, `GENERAL`, `RAG_QUERY`, and `TOOL_TASK`.
  - **Semantic Response Caching (`api/services/semanticCache.ts`)**: Sub-50ms Time to First Token for greetings, small talk, and intellectual FAQs using Tier A exact matching (<0.1ms) and Tier B vector cosine similarity (15–30ms) with simulated fluid word streaming.
  - **Automatic Prefix Caching (APC) Prompt Builder (`api/lib/apcPrompt.ts`)**: Restructures prompts to keep static system instructions (Tokens 0..K) and conversation history (Tokens K..M) strictly at the invariant prefix, placing dynamic temporal timestamps and RAG chunks at the tail. Maximizes KV cache reuse in Ollama/vLLM backends, dropping cold TTFT by up to 90%.
  - **Direct Tool Resolution & 6s Parallel Heartbeat**: Bypasses Stage 0/1 LLM pre-checks for `TOOL_TASK`, invoking lightweight small models directly while emitting background status heartbeats every 6s to eliminate perceived latency during tool execution.
  - **Autonomous Knowledge Cutoff Detection & Internet Search Fallback (`api/lib/cutoffDetector.ts`)**: Evaluates model output mid-stream for knowledge cutoff refusals or post-cutoff event admissions (e.g., elections, current events beyond training cutoff). Automatically intercepts the refusal, queries live internet search via Tavily, and re-synthesizes an accurate answer in real time with source citations.
  - **True Server-Sent Events (SSE) Live Token Streaming Protocol**: Upgrades `/api/chat/stream` and `/api/chat/agent-stream` to standard SSE (`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`) with `data: ...\n\n` framing, eliminating TCP socket MTU buffering.
  - **Decoupled Frontend Render Pipeline (`chat.js`)**: Decouples network read loops from DOM updates via `requestAnimationFrame` scheduling. Batches heavy markdown parsing (`marked.parse`) and syntax highlighting (`hljs.highlightElement`) to 60 FPS display frames, preventing main thread starvation and eliminating token dumping/freezes.
  - **Aurora Gold Luxury Micro-Interactions**: Features an animated vector buffer ring (`getBufferSpinnerSvg()`) matching the workstation's gold luxury palette, soft-blur cutoff refusal transition (`.cutoff-transitioning`), and smooth upward slide-in (`.answer-fade-enter`) for synthesized answers.
- **Instant Startup Boot & SSR Timeout Elimination**:
  - **Vite Watcher Decoupling (`vite.config.ts`)**: Introduced `WATCH_IGNORED` regex to exclude `.venv`, `storage/`, `uploads/`, and media directories from recursive file watching, slashing boot time from 5–7 minutes to under 3 seconds.
  - **Lazy Model Initialization**: Surya OCR, Surya Layout, and Marker PDF defer neural weight loading to first inference via `_ensure_loaded()`.
  - **Asynchronous Server Warmup (`api/boot.ts`)**: Decoupled speech and Python runtime initialization from top-level `await` to eliminate Vite 60s `fetchModule` RPC timeouts.
- **Multi-GPU Dual Ollama Architecture (`worker/ollama_dual.py`)**:
  - Segregates heavy reasoning and Agent Loop inference (Port 11434) from background embedding, vision, and speech tasks (Port 11435).
  - Isolates GPU compute contexts via pinned `CUDA_VISIBLE_DEVICES` with automated health recovery.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [V2.0 Workstation Architecture](#v20-workstation-architecture)
3. [Security & Authentication Subsystem](#security--authentication-subsystem)
4. [Module Overview](#module-overview)
5. [Tech Stack](#tech-stack)
6. [Database Schema](#database-schema)
7. [Backend API](#backend-api)
8. [Chatspace](#chatspace)
9. [Image Studio](#image-studio)
10. [FramesX](#framesx)
11. [Voice Studio](#voice-studio)
12. [Forge & ForgeX (Tiered Execution)](#forge--forgex-tiered-execution)
13. [Files and Document Intelligence](#files-and-document-intelligence)
14. [Knowledge Base and RAG](#knowledge-base-and-rag)
15. [Monitor](#monitor)
16. [Persona Studio](#persona-studio)
17. [Python Runtime](#python-runtime)
18. [Speech Runtime](#speech-runtime)
19. [Memory System](#memory-system)
20. [Distributed GPU Cluster Workers](#distributed-gpu-cluster-workers)
21. [Frontend Architecture](#frontend-architecture)
22. [Production Deployment Guide (Oracle Cloud / Caddy)](#production-deployment-guide-oracle-cloud--caddy)
23. [Emergency 2AM Break-Glass Recovery Runbook](#emergency-2am-break-glass-recovery-runbook)
24. [Environment Variables](#environment-variables)
25. [Installation and Setup](#installation-and-setup)
26. [Running the Project](#running-the-project)
27. [Automated Verification Test Suite](#automated-verification-test-suite)
28. [Project Structure](#project-structure)

---

## Philosophy

Most AI tools are built around the idea of access: you access their models, you access their servers, and your data passes through their infrastructure. n0th1ng AI is built around the opposite idea: **ownership**.

Every component runs locally or on your private infrastructure:
- Models are served by Ollama on your own GPU or CPU
- Image generation runs through ComfyUI on your own hardware
- Video generation runs through LTX-Video and Wan2.1 locally
- Speech synthesis and recognition run through dedicated local Python runtimes
- All data is stored in your private MySQL database
- No data ever leaves your machine unless you explicitly configure an external provider
- Access is guarded by a single-user zero-trust workstation perimeter

The distance between intention and creation should collapse to zero. Every thought should have a render path. That is the design goal of n0th1ng AI.

---

## V2.0 Workstation Architecture

n0th1ng AI V2.0 employs a layered defense-in-depth pipeline bridging user authentication, reverse proxy termination, API services, and distributed compute workers.

```text
[ Browser / Native Authenticator ] 
                │
                ▼
┌────────────────────────────────────────────────────────┐
│  Cloudflare Access / Zero Trust (Phase 7)              │
│  - Outer Perimeter RS256 JWK Validation                │
│  - Service Token Verification for Automated Traffic    │
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  Reverse Proxy (Caddy / Nginx) (Phase 8)               │
│  - TLS Termination & Strict Transport Security (HSTS)  │
│  - SSE & WebSocket stream pass-through (127.0.0.1:3000)│
└───────────────────────┬────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│  n0th1ng AI Workstation Gatekeeper (api/boot.ts)       │
│  - Fetch Metadata CSRF Guard (Sec-Fetch-Site check)    │
│  - Opaque Signed Session Token (HMAC-SHA256)           │
│  - Argon2id Password / RFC 6238 TOTP / FIDO2 Passkeys  │
│  - Trusted Device Pairing + Quick PIN Unlock           │
│  - In-Memory Progressive Rate Limiting & Lockout       │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
       [Human Session]             [Worker Lane]
                │                        │
                ▼                        ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ Execution Gate (Phase 6) │   │ Cluster Worker Endpoint  │
│ - scope: "standard"      │   │ - SHA-256 Key Registry   │
│ - scope: "forge_unlocked"│   │ - Remote GPU Task Proxy  │
│ - Step-Up Elevation      │   │ - Telemetry Ingestion    │
└───────────────┬──────────┘   └──────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────┐
│  Core Workstation Engine & Local Runtimes              │
│  - Hono API / tRPC v11 / Drizzle ORM (MySQL)           │
│  - Ollama LLM / ComfyUI / LTX-Video / Wan2.1           │
│  - Python FastAPI Sidecars (OCR, Vision, Speech, Moshi)│
└────────────────────────────────────────────────────────┘
```

---

## Security & Authentication Subsystem

### 1. Master Password (Argon2id)
- **Algorithm**: `argon2id` via native bindings.
- **Parameters**: 64 MB memory cost (`m=65536`), 3 iterations (`t=3`), 1 thread (`p=1`). Fully tunable via `ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`, and `ARGON2_PARALLELISM`.
- **Storage**: Stored in a single-row `auth_credentials` table. Never stored in plain text.
- **Password Updates**: Automatically revokes all existing sessions upon password reset.

### 2. Time-Based One-Time Passwords (TOTP 2FA)
- **Standard**: RFC 6238 HMAC-SHA1 TOTP using `speakeasy` and `qrcode`.
- **Encryption at Rest**: Shared secrets are encrypted in `auth_totp_secrets.secret` via AES-256-GCM using keys derived from `APP_SECRET`.
- **Clock Drift Tolerance**: Strictly bounded to `window: 1` (current step ± 1, allowing 90s total tolerance). Arbitrary or wide timestamp scans are rejected.
- **Replay Protection**: Stores `lastVerifiedStep` in the database. Verifications perform an atomic SQL test-and-set query:
  ```typescript
  where(
    and(
      eq(authTotpSecrets.id, row.id),
      or(
        isNull(authTotpSecrets.lastVerifiedStep),
        lt(authTotpSecrets.lastVerifiedStep, matchedStep)
      )
    )
  )
  ```
  If `affectedRows === 0`, the attempt is rejected as `code_already_used`, preventing duplicate submissions or race conditions across login and elevation flows.
- **Pending-Token Intermediate State**: Unauthenticated sessions waiting for second-factor entry receive a temporary 32-byte opaque token with a 5-minute TTL. Pending tokens cannot access any application routes.

### 3. Trusted Device Pairing & Quick PIN Unlock
- **Device Trust Model**: Upon successful full credential login, the operator can check "Remember this device". A 32-byte opaque token is cryptographically signed (`HMAC-SHA256`) and set as an `HttpOnly` cookie (`n0th1ng_device_trust`), completely isolated from the session cookie.
- **Quick PIN Architecture**: A 4–8 digit PIN is hashed with Argon2id and stored exclusively on the paired device record. PIN unlock (`POST /api/auth/pin/unlock`) only succeeds when presented with a valid device trust cookie.
- **Scope Isolation**: PIN-unlocked sessions are strictly assigned `scope: "standard"`. They cannot execute code or Forge tasks without step-up elevation.
- **Auto-Lock on Inactivity**: Global activity tracker in `frontend/assets/nav.js` monitors user interaction. After 15 minutes of inactivity or system sleep, the session is terminated and returns to `/frontend/login/?idle=true`.

### 4. WebAuthn / Passkeys (FIDO2)
- **Standard**: W3C WebAuthn Level 3 / FIDO2 via audited `@simplewebauthn/server` and `@simplewebauthn/browser`.
- **Supported Authenticators**: Windows Hello, Apple Touch ID / Face ID, Android biometrics, and physical YubiKeys / Titan keys.
- **Challenge Lifecycle**: Cryptographic random challenges are tracked in-memory with a 5-minute TTL and atomically consumed upon verification to prevent replay attacks.
- **Dynamic Origin Resolution**: Dynamically verifies Relying Party ID (`rpID`) and expected origins from the request, accepting both local development hosts and production HTTPS domains without code changes.

### 5. Tiered Trust & Step-Up Elevation
- **Scope Segregation**:
  - `scope: "standard"`: Granted by PIN unlock. Allows reading chat history, inspecting telemetry, searching documents, and conversational querying.
  - `scope: "forge_unlocked"`: Granted by full Master Password, TOTP, or Passkey authentication. Required to run Forge, ForgeX, execute arbitrary code, or modify server runtimes.
- **tRPC Enforcement**: Procedures in `api/forge/`, `api/forgex/`, and `api/routers/runtime.ts` use `elevatedForgeProcedure`, returning `FORBIDDEN: ELEVATION_REQUIRED` for standard sessions.
- **Idle Auto-Demotion**: Sessions with `forge_unlocked` that remain idle for 30 minutes are automatically downgraded to `standard` in the database.
- **Elevation Modal**: The UI intercepts `ELEVATION_REQUIRED` errors and displays a glassmorphic prompt to re-authenticate with Master Password or Passkey without reloading the page.

### 6. Cloudflare Access Outer Perimeter
- **Native RS256 Verification**: Pure Node `crypto` JWK verification without external JWT libraries.
- **Public Certificate Caching**: Automatically fetches and caches signing keys from Cloudflare Access (`/cdn-cgi/access/certs`) with a 1-hour TTL.
- **Service Tokens**: Validates `CF-Access-Client-Id` and `CF-Access-Client-Secret` using constant-time string comparison (`crypto.timingSafeEqual`) for automated worker communication.
- **Development Passthrough**: Seamlessly bypassed when running on `localhost:3000` with `CF_ACCESS_REQUIRED=false`.

### 7. CSRF Defense & Security Headers
- **Fetch Metadata Inspection**: Inspects `Sec-Fetch-Site`. Any state-changing method (`POST`, `PUT`, `DELETE`, `PATCH`) originating cross-site is immediately aborted with HTTP 403 `CSRF_DETECTED`.
- **Explicit Origin Allowlist**: Validates `Origin` and `Referer` against explicit operator-configured variables (`ALLOWED_ORIGINS`, `PRODUCTION_ORIGIN`), never blindly trusting client-supplied Host headers.
- **Response Headers**: Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and conditional `Strict-Transport-Security` over HTTPS.

---

## Module Overview

| Module | Description | Access Tier | Status |
|---|---|---|---|
| **Chatspace** | Multi-model conversational AI with tool use, RAG, memory, and agent mode | Standard | Live |
| **Image Studio** | Text-to-image generation via ComfyUI with 10+ configured workflows | Standard | Live |
| **FramesX** | Multi-scene cinematic video generation via LTX-Video and Wan2.1 | Standard | Live |
| **Voice Studio** | Local TTS/STT with 7+ providers and voice conversations with memory | Standard | Live |
| **Forge** | Autonomous multi-task build agent with plan/act/evaluate loop | Elevated (`forge_unlocked`) | Live |
| **ForgeX** | Agentic coding via Claude Code CLI bridged to local Ollama | Elevated (`forge_unlocked`) | Live |
| **Files & Docs** | Document library with OCR, PDF parsing, and LangGraph analysis pipeline | Standard | Live |
| **Knowledge Base** | RAG-powered vector store with semantic search and embeddings | Standard | Live |
| **Monitor** | Real-time system telemetry: CPU, GPU, VRAM, RAM, network, services | Standard | Live |
| **Persona Studio** | NVIDIA Moshi real-time voice-to-voice AI persona streaming | Standard | Live |
| **Cluster System** | Remote GPU worker node management and log streaming | Elevated / Machine | Live |
| **Settings** | System configuration, model management, provider keys | Standard | Live |

---

## Tech Stack

### Core Runtime
| Layer | Technology |
|---|---|
| **Server Framework** | Hono v4 — ultra-fast HTTP framework for Node.js |
| **API Layer** | tRPC v11 — end-to-end typesafe RPC |
| **ORM** | Drizzle ORM v0.45 — fully typesafe SQL ORM |
| **Database** | MySQL 8.0+ via `mysql2` |
| **Security & Auth** | Argon2id, `@simplewebauthn/server`, `speakeasy`, native Node `crypto` |
| **Language** | TypeScript 5.9 strict mode throughout |
| **Build Tool** | Vite 7 (frontend) + esbuild (backend bundle) |
| **Runtime** | Node.js v22+ (ESM) |

### Frontend Design System
| Layer | Technology |
|---|---|
| **Architecture** | Multi-page application — plain HTML, CSS, vanilla JS per module |
| **Design Language** | Aurora glassmorphism, responsive mobile drawer, micro-animations |
| **Typography** | Inter Tight (UI), JetBrains Mono (Code/Telemetry) |
| **Auth Integration** | Auto-lock inactivity timer, Step-Up elevation modal, WebAuthn browser handlers |

### AI and Runtimes
| Component | Technology |
|---|---|
| **LLM Serving** | Local Ollama (Qwen, LLaMA, DeepSeek, Mistral) + OpenRouter bridge |
| **Image Generation** | ComfyUI (FLUX, SDXL, SD 1.5, Photorealistic checkpoints) |
| **Video Generation** | LTX-Video 2B distilled and Wan2.1 1.3B T2V via ComfyUI |
| **Document Runtime** | FastAPI sidecar: Tesseract, Surya, PaddleOCR, marker-pdf, LangGraph |
| **Speech Runtime** | FastAPI sidecar: Kokoro, Chatterbox, XTTS v2, Piper, Whisper |
| **PersonaPlex** | NVIDIA Moshi speech-to-speech engine via bidirectional WebSockets |

---

## Database Schema

Persistent state is stored in MySQL via Drizzle ORM (`db/schema.ts`).

### V2.0 Authentication & Security Tables
| Table | Purpose |
|---|---|
| `auth_credentials` | Stores the Argon2id master password hash and timestamp metadata |
| `auth_totp_secrets` | Encrypted RFC 6238 TOTP secrets (AES-256-GCM), verification status, and `lastVerifiedStep` replay step |
| `auth_webauthn_credentials` | FIDO2/Passkey credentials: credential ID, public key, counter, transports, and device label |
| `sessions` | Active sessions: 64-char token, `scope` (`standard` vs `forge_unlocked`), `methodUsed`, IP, expiration, revocation |
| `device_trust` | Paired trusted devices: signed token, Argon2id-hashed Quick PIN, device metadata, expiration |
| `worker_api_keys` | Headless cluster machine keys: SHA-256 hash, label, last used timestamp, revocation status |
| `auth_audit_log` | Security audit trail: timestamp, method, success status, IP, User-Agent, failure reason |

### Application Tables
- **Chat & Conversations**: `users`, `conversations`, `messages`, `message_tool_calls`, `folders`
- **Generations**: `ai_models`, `generated_images`, `generated_videos`
- **Knowledge & RAG**: `files`, `file_folders`, `file_contents`, `knowledge_chunks`, `chunk_embeddings`, `knowledge_entries`, `document_analysis`, `chat_attachments`
- **Voice & Personas**: `voice_conversations`, `voice_messages`
- **Memory**: `memories`, `memory_chunks`, `memory_chunk_embeddings`
- **Forge & ForgeX**: `forge_sessions`, `forge_task_nodes`, `forge_iterations`, `forgex_sessions`, `forgex_output`
- **Telemetry & Monitoring**: `system_snapshots`, `services`, `activity_logs`, `workflows`

---

## Backend API

Mounted in `api/boot.ts` with zero-trust gatekeeper middleware guarding all procedures.

### V2.0 Authentication Router (`/api/auth/*`)
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/auth/status` | Public | Returns whether Master Password is initialized |
| `POST` | `/api/auth/setup` | Public (First-Run) | Sets initial Master Password (disabled once configured) |
| `POST` | `/api/auth/login` | Public (Rate-Limited) | Verifies password; returns session cookie or TOTP requirement |
| `POST` | `/api/auth/logout` | Public / Session | Revokes active session in database and clears session cookies |
| `GET` | `/api/auth/me` | Session | Returns current session status, device info, and active scope |
| `POST` | `/api/auth/totp/verify-login` | Public (Rate-Limited) | Consumes pending token and 6-digit TOTP code to mint session |
| `GET` | `/api/auth/totp/status` | Session | Checks if TOTP 2FA is active on the account |
| `POST` | `/api/auth/totp/enroll` | Session | Generates new encrypted TOTP secret and returns QR data URL |
| `POST` | `/api/auth/totp/verify` | Session | Verifies initial enrollment code and activates TOTP 2FA |
| `POST` | `/api/auth/totp/disable` | Session | Disables TOTP 2FA (requires master password verification) |
| `GET` | `/api/auth/device-trust/status` | Public | Checks if incoming request has a valid `n0th1ng_device_trust` cookie |
| `POST` | `/api/auth/pin/unlock` | Device Trust | Unlocks workstation using 4–8 digit PIN; mints `standard` session |
| `POST` | `/api/auth/device-trust/revoke` | Session | Revokes trust for the current device and removes pairing record |
| `GET` | `/api/auth/webauthn/status` | Public | Returns whether WebAuthn/Passkey authentication is available |
| `POST` | `/api/auth/webauthn/login-options` | Public | Returns assertion challenge and allowed credential IDs |
| `POST` | `/api/auth/webauthn/login-verify` | Public | Verifies passkey assertion signature; mints operator session |
| `POST` | `/api/auth/webauthn/register-options`| Session | Generates attestation challenge for registering a new passkey |
| `POST` | `/api/auth/webauthn/register-verify` | Session | Verifies and stores new passkey public key and credential ID |
| `GET` | `/api/auth/webauthn/credentials` | Session | Lists registered passkeys (ID, label, creation, last used) |
| `DELETE`| `/api/auth/webauthn/credentials/:id` | Session | Deletes and revokes a registered passkey |
| `POST` | `/api/auth/elevate` | Session | Step-Up re-authentication (Password, TOTP, or Passkey) to `forge_unlocked` |
| `POST` | `/api/auth/demote` | Session | Drops session from `forge_unlocked` back to `standard` scope |
| `GET` | `/api/auth/cloudflare/status` | Public | Diagnostic endpoint reporting Cloudflare Access configuration |

---

## Distributed GPU Cluster Workers

n0th1ng AI supports offloading intensive inference (LLMs, ComfyUI image/video, speech synthesis) to dedicated remote GPU worker machines via the `worker/` subsystem.

### Worker Architecture & Reverse Tunnels
Each remote worker machine runs:
1. **Raw Worker Server (`worker/src/server.ts`)**: Runs on loopback `127.0.0.1:3001` handling tool execution (`POST /execute`, `POST /tool`, `POST /speech`).
2. **Exposure Gateway Proxy (`worker/src/exposureService.ts`)**: Runs on `127.0.0.1:3443` (configurable via `EXPOSE_PORT`).
   - Sits directly in front of the raw server.
   - Enforces `checkApiKey` using constant-time comparison (`crypto.timingSafeEqual`).
   - Automatically rejects default placeholders (`CHANGE_ME_generate_a_64_char_hex_key_here`).
   - Enforces IP sliding-window rate limiting.
   - Logs remote requests to MySQL access log table.
3. **Cloudflare Tunnel Routing**:
   - **Quick Mode**: Automatically starts `cloudflared` targeting `http://127.0.0.1:3443` (the authenticated proxy), ensuring unauthenticated traffic can never reach raw port `3001`.
   - **Named Mode**: Named tunnels must configure ingress to route to `http://127.0.0.1:3443`.
4. **Resilient DB Decoupling**: If `WORKER_DATABASE_URL` is omitted, the worker operates smoothly in DB-less mode without startup crashes or broken auth.

### Managing Worker Keys (Master Node)
Cluster workers authenticate using SHA-256 pre-shared API keys. Manage them from the master workstation via CLI:

```bash
# Provision a new worker key
npm run worker:keys create "GPU-Desktop-RTX4090"

# List active and revoked worker keys
npm run worker:keys list

# Revoke a compromised worker key
npm run worker:keys revoke <KEY_ID>
```

---

## Production Deployment Guide (Oracle Cloud / Caddy)

Deploying n0th1ng AI V2.0 on a public Oracle Cloud Infrastructure (OCI) Compute Instance or VPS behind Caddy and Cloudflare Zero Trust.

### 1. Reverse Proxy Configuration (`/etc/caddy/Caddyfile`)
Caddy provides automatic TLS, robust HTTP/2 and HTTP/3 support, and unbuffered streaming for Server-Sent Events (SSE) and WebSockets.

```caddy
# Production Domain
ai.yourdomain.com {
    # Reverse proxy to local n0th1ng AI workstation
    reverse_proxy 127.0.0.1:3000 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-Host {host}

        # Keep unbuffered flush for live LLM tokens and Forge WebSocket streaming
        flush_interval -1
    }

    # Hardened Security Headers
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

### 2. Systemd Service Unit (`/etc/systemd/system/n0th1ng-ai.service`)
```ini
[Unit]
Description=n0th1ng AI V2.0 Workstation Server
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

Reload and enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now n0th1ng-ai
```

---

## Emergency 2AM Break-Glass Recovery Runbook

If you are locked out of your workstation (forgotten master password, lost 2FA authenticator, broken security key, or locked session):

### Interactive Terminal Recovery
1. **SSH into the Host / Cloud Instance**:
   ```bash
   ssh -i ~/.ssh/id_rsa ubuntu@your-server-ip
   cd /opt/n0th1ng-ai/app
   ```
2. **Run the Auth Reset Tool**:
   ```bash
   npm run auth:reset
   ```
3. Follow the prompt to enter a new Master Password (min 8 characters) or press Enter to generate a secure random passphrase.
4. If TOTP 2FA is active, the tool will prompt:
   `TOTP is active. Disable TOTP to remove 2FA lockout? (y/N):`
   Type `y` to disable 2FA immediately.

### Non-Interactive CLI Recovery
To recover in a single command without interactive prompts:
```bash
npx tsx scripts/reset-auth.ts --password="YourNewSecureMasterPassword123!" --reset-totp
```

The recovery script atomically:
- Hashes the new password with Argon2id and writes it to `auth_credentials`
- Revokes all existing active sessions in `sessions`
- Disables TOTP in `auth_totp_secrets` (if requested)
- Resets rate limiting lockouts

---

## Environment Variables

Configure these settings in `app/.env` (based on `app/.env.example`):

```env
# ── Core Application ────────────────────────────────────────────────────────
APP_ID=n0th1ng-ai
APP_SECRET=your_super_secret_64_char_hex_key_here
PORT=3000

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=mysql://root:password@localhost:3306/nothingai

# ── V2.0 Argon2id Tuning (Optional) ──────────────────────────────────────────
ARGON2_MEMORY_COST=65536     # 64 MB
ARGON2_TIME_COST=3           # 3 iterations
ARGON2_PARALLELISM=1         # 1 thread

# ── V2.0 Origin & WebAuthn Configuration ─────────────────────────────────────
# Operator domain when deployed on public cloud
PRODUCTION_ORIGIN=https://ai.yourdomain.com
ALLOWED_ORIGINS=https://ai.yourdomain.com,http://localhost:3000
WEBAUTHN_RP_ID=yourdomain.com
WEBAUTHN_ORIGIN=https://ai.yourdomain.com

# ── V2.0 Cloudflare Access Outer Perimeter (Optional) ────────────────────────
CF_ACCESS_REQUIRED=false
CF_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CF_ACCESS_AUD=your_cloudflare_access_application_aud_tag

# ── External AI Providers ────────────────────────────────────────────────────
OPENROUTER_API_KEY=your_openrouter_key
TAVILY_API_KEY=your_tavily_key
FIRECRAWL_API_KEY=your_firecrawl_key

# ── Local Runtimes ───────────────────────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434
COMFYUI_URL=http://localhost:8188
CLAUDE_CODE_BIN=C:\Users\username\.local\bin\claude.exe

# ── Remote Cluster Worker Pre-Shared Keys ────────────────────────────────────
WORKER_DESKTOP_URL=https://worker.yourdomain.com
WORKER_DESKTOP_KEY=your_worker_preshared_key
```

---

## Installation and Setup

### Prerequisites
- **Node.js**: v22.0.0 or higher
- **npm**: v10.0.0 or higher
- **MySQL**: 8.0 or higher
- **Ollama**: Latest version (for local LLMs)
- **Python**: 3.10–3.12 (for sidecars; PersonaPlex requires <= 3.12)
- **CUDA**: 12+ (optional, for local GPU acceleration)

### Step-by-Step Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/n0th1ngg05/n0th1ng-ai.git
   cd n0th1ng-ai/app
   ```

2. **Install Node dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your MySQL credentials and a secure APP_SECRET
   ```

4. **Initialize Database**:
   ```bash
   # Push baseline schema
   npm run db:push

   # Apply V2.0 security tables
   npx tsx scripts/migrate-auth.ts
   ```

5. **Initialize Master Password**:
   ```bash
   # Set your workstation master password via CLI
   npm run auth:reset
   ```

6. **(Optional) Set up Python Sidecars**:
   ```bash
   # Document Analysis & OCR Runtime
   cd python-runtime
   python -m venv .venv
   source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   cd ..

   # Speech Studio Runtime
   cd speech-runtime
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd ..
   ```

---

## Running the Project

### Development Mode
Runs the Vite frontend dev server and Hono API server with live reloading:
```bash
npm run dev
```
Workstation UI will be available at: `http://localhost:3000` (or `http://localhost:5173`).

### Production Mode
Builds client bundles and executes the production Hono server:
```bash
npm run build
npm start
```

### Starting Distributed GPU Workers
On your remote GPU machine:
```bash
cd worker
npm install
npm run dev
```

---

## Automated Verification Test Suite

n0th1ng AI V2.0 includes standalone automated test suites in `scripts/` validating every security phase against live database queries and cryptographic assertions:

```bash
# Phase 3: TOTP Drift, Encryption & Replay Protection
npx tsx scripts/test-phase3-totp.ts

# Phase 4: Device Trust, Cookie Signing & Quick PIN
npx tsx scripts/test-phase4-pin.ts

# Phase 5: WebAuthn / Passkeys (FIDO2) Assertion & Challenges
npx tsx scripts/test-phase5-webauthn.ts

# Phase 6: Tiered Trust, tRPC Scope Gate & Step-Up Elevation
npx tsx scripts/test-phase6-tiered-trust.ts

# Phase 7: Cloudflare Access Outer Perimeter RS256 Verification
npx tsx scripts/test-phase7-cloudflare.ts

# Phase 8: Production CSRF, Origin Allowlist & Security Headers
npx tsx scripts/test-phase8-hardening.ts
```

---

## Project Structure

```text
n0th1ng-ai/
├── app/                              # Primary Workstation Master Node
│   ├── api/                          # Hono Backend Application
│   │   ├── boot.ts                   # Gateway middleware, routes, asset filters
│   │   ├── router.ts                 # Root tRPC router
│   │   ├── context.ts                # Session-aware tRPC context
│   │   ├── middleware.ts             # Elevated Forge procedure guards
│   │   ├── routers/
│   │   │   ├── auth.router.ts        # V2.0 Authentication & Passkey HTTP router
│   │   │   ├── chat.ts               # Chatspace conversations & messages
│   │   │   ├── cluster.ts            # Distributed GPU worker registration
│   │   │   └── ...                   # 15+ specialized routers
│   │   ├── services/
│   │   │   ├── auth.service.ts       # Central auth logic: Argon2id, TOTP, WebAuthn, PIN
│   │   │   ├── security.service.ts   # CSRF protection & HTTP security headers
│   │   │   ├── cloudflare.service.ts # RS256 JWK certs & service token verification
│   │   │   ├── agentLoop.ts          # Extended multi-round tool agent engine
│   │   │   ├── memory.ts             # Persistent semantic memory store
│   │   │   └── ...                   # 40+ business logic services
│   │   └── forge/                    # Forge & ForgeX autonomous build controllers
│   ├── db/
│   │   ├── schema.ts                 # Complete Drizzle schema (37+ tables)
│   │   └── migrations/               # Schema migration journals & snapshots
│   ├── frontend/                     # Multi-page Aurora Design System UI
│   │   ├── assets/
│   │   │   ├── nav.js                # Navbar, idle auto-lock, Step-Up elevation modal
│   │   │   └── nav.css               # Glassmorphic aurora navigation styling
│   │   ├── login/                    # V2.0 Workstation Login & Setup UI
│   │   │   ├── index.html            # Password, TOTP, PIN, and Passkey interfaces
│   │   │   ├── login.js              # WebAuthn and credential unlock handlers
│   │   │   └── login.css             # Glassmorphic login styling
│   │   ├── chatspace/                # Primary chat interface
│   │   ├── studio/                   # ComfyUI Image Studio
│   │   ├── framesx/                  # FramesX cinematic video generator
│   │   ├── voice/                    # Voice Studio TTS/STT
│   │   ├── forge/                    # Autonomous agent builder
│   │   ├── forgex/                   # Claude Code CLI interactive UI
│   │   ├── monitor/                  # System hardware telemetry
│   │   └── ...
│   ├── scripts/
│   │   ├── reset-auth.ts             # 2AM emergency CLI password recovery tool
│   │   ├── manage-worker-keys.ts     # CLI worker pre-shared key manager
│   │   ├── migrate-auth.ts           # Non-destructive schema migration runner
│   │   └── test-phase*.ts            # Automated security regression test suites
│   ├── python-runtime/               # Document Intelligence FastAPI Sidecar
│   ├── speech-runtime/               # TTS & STT FastAPI Sidecar
│   ├── personaplex-runtime/          # NVIDIA Moshi Real-Time Voice Sidecar
│   └── package.json                  # Workstation scripts and dependencies
│
├── worker/                           # Remote GPU Cluster Node Subsystem
│   ├── src/
│   │   ├── server.ts                 # Raw local inference server (port 3001)
│   │   ├── exposureService.ts        # Authenticated Gateway Proxy (port 3443)
│   │   ├── capabilities.ts           # Hardware & runtime capability discovery
│   │   └── db/                       # Resilient worker database client
│   └── package.json
│
└── README.md                         # Project Documentation
```

---

## License

Built by **n0th1ng Studios**.

*You Imagine, We Render.*
