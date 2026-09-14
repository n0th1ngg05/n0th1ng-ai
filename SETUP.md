# Worker HUD — Setup Guide

## First-Time Setup

### 1. Create the MySQL database

On this machine, open MySQL and run:

```sql
CREATE DATABASE workerdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Fill in `.env`

Open `worker/.env` and set:

```dotenv
WORKER_DATABASE_URL=mysql://root:YOUR_PASSWORD@localhost:3306/workerdb

# Generate these once:
WORKER_API_KEY=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
HUD_TOKEN=<run: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))">
```

> The `WORKER_API_KEY` is what the remote Master must send as `Authorization: Bearer <key>` to reach this worker over the internet.
> The `HUD_TOKEN` is what the local HUD uses to talk to the exposure service `/internal/*` endpoints.

### 3. Install cloudflared

Download from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
and place `cloudflared.exe` in your PATH (e.g. `C:\Windows\System32\` or any PATH directory).

Quick test: `cloudflared --version`

### 4. Run everything

```bash
cd d:\AI\Chatbot\worker
npm run dev
```

This starts all four processes in one terminal with color-coded prefixes:
- `[WORKER]` cyan   — Node worker on :3001
- `[EXPOSE]` green  — Internet exposure service on :3443
- `[HUD]`    yellow — Vite HUD on :5173
- `[TRAY]`   magenta — Electron system tray

### 5. Open the HUD

Either:
- Navigate to http://localhost:5173
- Or double-click the tray icon in the Windows system tray

---

## Internet Exposure Modes

| Mode | Behavior |
|---|---|
| **AUTO** | Off while master is reachable. Auto-triggers internet after 10 min of disconnect. Returns to local when master reconnects. |
| **FORCE ON** | Always expose, regardless of master status. Persists across restarts. |
| **FORCE OFF** | Never expose, regardless of master status. Persists across restarts. |

Control via the HUD toggle or the system tray context menu.

---

## Giving the URL to the Master

When exposed, the HUD shows the Cloudflare URL (e.g. `https://abc-def-ghi.trycloudflare.com`).

The Master must set in its own `.env`:
```
WORKER_DESKTOP_URL=https://abc-def-ghi.trycloudflare.com
WORKER_DESKTOP_KEY=<same value as WORKER_API_KEY above>
```

Note: Quick Tunnel URLs change every session. For a stable URL, set up a Named Tunnel (see `.env` comments for `CF_TUNNEL_MODE=named`).
