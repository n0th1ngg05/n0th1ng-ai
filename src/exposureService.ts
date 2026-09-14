import "dotenv/config";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { connectionState } from "./connectionState";
import { initDb, getConfig, setConfig } from "./db/index";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToggleMode = "AUTO" | "FORCE_ON" | "FORCE_OFF";

// ── Config ────────────────────────────────────────────────────────────────────

const WORKER_URL   = "http://127.0.0.1:3001";
const PORT         = parseInt(process.env.EXPOSE_PORT ?? "3443", 10);
const API_KEY      = process.env.WORKER_API_KEY ?? "";
const HUD_TOKEN    = process.env.HUD_TOKEN ?? "";
const AUTO_DELAY   = parseInt(process.env.AUTO_EXPOSE_DELAY_MS ?? "600000", 10); // 10 min default
const CF_MODE      = (process.env.CF_TUNNEL_MODE ?? "quick") as "quick" | "named" | "dashboard";
const CF_TUNNEL_NAME = process.env.CF_TUNNEL_NAME ?? "";
const CF_CREDS_PATH  = process.env.CF_TUNNEL_CREDS_PATH ?? "";

// Resolve cloudflared binary — check worker root folder first (Option A drop-in),
// then fall back to system PATH.
const WORKER_ROOT   = path.resolve(__dirname, "..", "..");
const LOCAL_CF_PATH = path.join(WORKER_ROOT, "cloudflared.exe");
const CF_BIN        = existsSync(LOCAL_CF_PATH) ? LOCAL_CF_PATH : "cloudflared";

// ── Rate limiter (in-memory sliding window) ───────────────────────────────────

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX       = parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10);

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const window = RATE_LIMIT_WINDOW_MS;
    const times = (rateLimitMap.get(ip) ?? []).filter(t => now - t < window);
    times.push(now);
    rateLimitMap.set(ip, times);
    return times.length > RATE_LIMIT_MAX;
}

// ── Tunnel state ──────────────────────────────────────────────────────────────

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl     = "";
let isExposed     = false;
let toggleMode: ToggleMode = "AUTO";

// ── Auto-trigger timer ────────────────────────────────────────────────────────

let autoTimer: ReturnType<typeof setTimeout> | null = null;
let autoTimerFiredAt: number | null = null;   // tracks when timer is due
let autoTimerStartedAt: number | null = null;

function clearAutoTimer() {
    if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
        autoTimerFiredAt  = null;
        autoTimerStartedAt = null;
        console.log("[EXPOSE] Auto-trigger timer cancelled (master reconnected)");
    }
}

function startAutoTimer() {
    if (autoTimer) return; // already running
    autoTimerStartedAt = Date.now();
    autoTimerFiredAt   = autoTimerStartedAt + AUTO_DELAY;
    console.log(`[EXPOSE] Master disconnected — auto-trigger internet in ${AUTO_DELAY / 60000} min`);
    autoTimer = setTimeout(async () => {
        autoTimer         = null;
        autoTimerFiredAt  = null;
        autoTimerStartedAt = null;
        console.log("[EXPOSE] Auto-trigger fired — starting Cloudflare tunnel...");
        await startTunnel();
    }, AUTO_DELAY);
}

// ── Cloudflare tunnel process ─────────────────────────────────────────────────

async function startTunnel(): Promise<void> {
    if (tunnelProcess || (CF_MODE === "dashboard" && isExposed)) {
        console.log("[EXPOSE] Tunnel already running — skipping start");
        return;
    }

    console.log("[EXPOSE] ========================================");
    console.log("[EXPOSE] Starting Cloudflare tunnel...");
    console.log(`[EXPOSE] Mode: ${CF_MODE}`);
    console.log("[EXPOSE] ========================================");

    if (CF_MODE === "dashboard") {
        // Dashboard mode: Tunnel is running externally as a Windows Service.
        // We just open the proxy gate.
        isExposed = true;
        tunnelUrl = process.env.CF_TUNNEL_URL ?? "Dashboard Managed Tunnel";
        console.log("[EXPOSE] Gateway OPENED for Dashboard tunnel");
        return;
    }

    let args: string[];

    if (CF_MODE === "named" && CF_TUNNEL_NAME) {
        args = [
            "tunnel",
            "--no-autoupdate",
            "--credentials-file", CF_CREDS_PATH,
            "run",
            CF_TUNNEL_NAME,
        ];
    } else {
        // Quick tunnel — zero setup, random URL each run
        args = [
            "tunnel",
            "--no-autoupdate",
            "--url", WORKER_URL,
        ];
    }

    console.log(`[EXPOSE] Using cloudflared binary: ${CF_BIN}`);
    tunnelProcess = spawn(CF_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

    tunnelProcess.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        // Capture the public URL from cloudflared output
        const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com|https:\/\/[a-z0-9\-\.]+\.workers\.dev/i);
        if (match && !tunnelUrl) {
            tunnelUrl = match[0];
            setConfig("tunnel_url", tunnelUrl).catch(() => {});
            isExposed = true;
            console.log("[EXPOSE] ========================================");
            console.log("[EXPOSE] Tunnel ONLINE");
            console.log("[EXPOSE] Public URL:", tunnelUrl);
            console.log("[EXPOSE] ========================================");
        }
        // Mirror cloudflared output with prefix
        text.split(/\r?\n/).filter(Boolean).forEach(line =>
            console.log(`[CF] ${line}`)
        );
    });

    tunnelProcess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        // cloudflared writes the URL to stderr on quick-tunnel mode
        const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/i);
        if (match && !tunnelUrl) {
            tunnelUrl = match[0];
            setConfig("tunnel_url", tunnelUrl).catch(() => {});
            isExposed = true;
            console.log("[EXPOSE] ========================================");
            console.log("[EXPOSE] Tunnel ONLINE");
            console.log("[EXPOSE] Public URL:", tunnelUrl);
            console.log("[EXPOSE] ========================================");
        }
        text.split(/\r?\n/).filter(Boolean).forEach(line =>
            console.log(`[CF] ${line}`)
        );
    });

    tunnelProcess.on("exit", (code, signal) => {
        console.log(`[EXPOSE] cloudflared exited (code=${code}, signal=${signal})`);
        tunnelProcess = null;
        tunnelUrl     = "";
        isExposed     = false;
        setConfig("tunnel_url", "").catch(() => {});
    });

    tunnelProcess.on("error", (err) => {
        console.error("[EXPOSE] Failed to spawn cloudflared:", err.message);
        console.error("[EXPOSE] Make sure cloudflared is installed and in PATH");
        console.error("[EXPOSE] Download: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
        tunnelProcess = null;
        isExposed     = false;
    });
}

async function stopTunnel(): Promise<void> {
    if (CF_MODE === "dashboard") {
        console.log("[EXPOSE] ========================================");
        console.log("[EXPOSE] Gateway CLOSED for Dashboard tunnel");
        console.log("[EXPOSE] ========================================");
        isExposed = false;
        return;
    }

    if (!tunnelProcess) {
        console.log("[EXPOSE] No active tunnel to stop");
        return;
    }

    console.log("[EXPOSE] ========================================");
    console.log("[EXPOSE] Stopping Cloudflare tunnel...");
    console.log("[EXPOSE] ========================================");

    tunnelProcess.kill("SIGTERM");
    tunnelProcess = null;
    tunnelUrl     = "";
    isExposed     = false;
    await setConfig("tunnel_url", "");
}

// ── Toggle state machine ──────────────────────────────────────────────────────

async function applyToggle(mode: ToggleMode, source: "HUD" | "TRAY" | "AUTO" = "HUD") {
    const prev = toggleMode;
    toggleMode  = mode;
    await setConfig("toggle_mode", mode);

    console.log(`[EXPOSE] Toggle → ${mode} (via ${source}) [was: ${prev}]`);

    if (mode === "FORCE_ON") {
        clearAutoTimer();
        await startTunnel();
    } else if (mode === "FORCE_OFF") {
        clearAutoTimer();
        await stopTunnel();
    } else {
        // AUTO — re-evaluate current master state
        if (connectionState.connected) {
            await stopTunnel();
            clearAutoTimer();
            console.log("[EXPOSE] AUTO mode — master is online, staying local");
        } else {
            console.log("[EXPOSE] AUTO mode — master offline, starting auto-timer");
            startAutoTimer();
        }
    }
}

// ── Master connection listeners ───────────────────────────────────────────────

connectionState.on("connected", async () => {
    console.log("[EXPOSE] Master connected event received");
    if (toggleMode !== "AUTO") return;
    clearAutoTimer();
    if (isExposed) {
        console.log("[EXPOSE] Master back online — stopping internet tunnel (AUTO mode)");
        await stopTunnel();
    }
});

connectionState.on("disconnected", () => {
    console.log("[EXPOSE] Master disconnected event received");
    if (toggleMode !== "AUTO") return;
    startAutoTimer();
});

// ── Access logging ────────────────────────────────────────────────────────────

import mysql2 from "mysql2/promise";

let dbPool: mysql2.Pool | null = null;

async function logAccess(params: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    ip: string | null;
    tool: string | null;
}) {
    if (!dbPool) return;
    try {
        await dbPool.execute(
            `INSERT INTO worker_access_log (ts, method, path, status, duration_ms, ip, tool, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'remote')`,
            [Date.now(), params.method, params.path, params.status, params.durationMs, params.ip, params.tool]
        );
    } catch {
        // Never let logging break the proxy
    }
}

// ── Auth middleware helper ────────────────────────────────────────────────────

function getClientIp(req: Request): string {
    return req.headers.get("cf-connecting-ip")
        ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
        ?? "unknown";
}

function checkApiKey(req: Request): boolean {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
    return token === API_KEY && API_KEY.length > 0;
}

function checkHudToken(req: Request): boolean {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
    return token === HUD_TOKEN && HUD_TOKEN.length > 0;
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// ── /internal/* — HUD/tray control endpoints (HUD token auth) ─────────────────

app.get("/internal/status", async (c) => {
    const req = c.req.raw;
    if (!checkHudToken(req)) return c.json({ error: "Unauthorized" }, 403);

    const timeUntilAutoMs = (autoTimerFiredAt && autoTimerStartedAt)
        ? Math.max(0, autoTimerFiredAt - Date.now())
        : null;

    // Check runtime health server-side (no CORS issues for the browser)
    const check = (url: string) =>
        fetch(url, { signal: AbortSignal.timeout(1500) })
            .then(r => r.ok)
            .catch(() => false);

    const [pythonOk, speechOk, workerOk] = await Promise.all([
        check("http://127.0.0.1:8002/health"),
        check("http://127.0.0.1:9000/health"),
        check("http://127.0.0.1:3001/ping"),
    ]);

    return c.json({
        exposed:         isExposed,
        tunnelUrl:       tunnelUrl || null,
        toggleMode,
        masterConnected: connectionState.connected,
        autoTimerActive: autoTimer !== null,
        timeUntilAutoMs,
        uptime:          process.uptime() * 1000,
        port:            PORT,
        runtimes: {
            python: pythonOk,
            speech: speechOk,
            worker: workerOk,
            expose: true,   // if we're responding, we're up
        },
    });
});

app.post("/internal/toggle", async (c) => {
    const req = c.req.raw;
    if (!checkHudToken(req)) return c.json({ error: "Unauthorized" }, 403);

    const body = await c.req.json<{ mode: ToggleMode }>();
    const mode = body?.mode;

    if (!["AUTO", "FORCE_ON", "FORCE_OFF"].includes(mode)) {
        return c.json({ error: "mode must be AUTO | FORCE_ON | FORCE_OFF" }, 400);
    }

    await applyToggle(mode, "HUD");
    return c.json({ ok: true, mode });
});

app.get("/internal/metrics", async (c) => {
    const req = c.req.raw;
    if (!checkHudToken(req)) return c.json({ error: "Unauthorized" }, 403);

    if (!dbPool) return c.json({ error: "DB not ready" }, 503);

    const [history]   = await dbPool.execute<any[]>(
        `SELECT * FROM worker_tool_history ORDER BY started_at DESC LIMIT 100`
    );
    const [snapshots] = await dbPool.execute<any[]>(
        `SELECT * FROM worker_metrics_snapshots ORDER BY ts DESC LIMIT 120`
    );
    const [accessLogs] = await dbPool.execute<any[]>(
        `SELECT * FROM worker_access_log ORDER BY ts DESC LIMIT 50`
    );

    return c.json({ history, snapshots, accessLogs });
});

app.get("/internal/tunnel-url", (c) => {
    const req = c.req.raw;
    if (!checkHudToken(req)) return c.json({ error: "Unauthorized" }, 403);
    return c.json({ url: tunnelUrl || null });
});

// ── Proxy all other routes to :3001 (requires API key auth) ──────────────────

app.all("*", async (c) => {
    const req = c.req.raw;
    const ip  = getClientIp(req);
    const started = Date.now();

    // Exposure gate
    if (!isExposed) {
        console.log(`[EXPOSE] Blocked request (tunnel not active) from ${ip} ${req.method} ${c.req.path}`);
        await logAccess({ method: req.method, path: c.req.path, status: 503, durationMs: 0, ip, tool: null });
        return c.json({ error: "Worker not exposed — internet access is currently disabled" }, 503);
    }

    // Auth check
    if (!checkApiKey(req)) {
        console.log(`[EXPOSE] Unauthorized request from ${ip} ${req.method} ${c.req.path} — 401`);
        await logAccess({ method: req.method, path: c.req.path, status: 401, durationMs: Date.now() - started, ip, tool: null });
        return c.json({ error: "Unauthorized" }, 401);
    }

    // Rate limit
    if (isRateLimited(ip)) {
        console.log(`[EXPOSE] Rate limit hit from ${ip} — 429`);
        await logAccess({ method: req.method, path: c.req.path, status: 429, durationMs: Date.now() - started, ip, tool: null });
        return c.json({ error: "Too many requests" }, 429);
    }

    // Forward to local worker
    const targetUrl = `${WORKER_URL}${c.req.path}${c.req.raw.url.includes("?") ? "?" + c.req.raw.url.split("?")[1] : ""}`;

    let body: BodyInit | null = null;
    let tool: string | null   = null;

    try {
        if (!["GET", "HEAD"].includes(req.method)) {
            const raw = await req.text();
            body = raw;
            // Extract tool name for logging /execute calls
            if (c.req.path === "/execute" && raw) {
                try { tool = JSON.parse(raw)?.tool ?? null; } catch {}
            }
        }

        const upstream = await fetch(targetUrl, {
            method:  req.method,
            headers: req.headers,
            body,
        });

        const duration = Date.now() - started;

        console.log(`[EXPOSE] Remote → ${req.method} ${c.req.path}${tool ? ` (tool: ${tool})` : ""} → ${upstream.status} in ${duration}ms [${ip}]`);
        await logAccess({ method: req.method, path: c.req.path, status: upstream.status, durationMs: duration, ip, tool });

        // Stream response back to caller
        return new Response(upstream.body, {
            status:  upstream.status,
            headers: upstream.headers,
        });

    } catch (err: any) {
        const duration = Date.now() - started;
        console.error(`[EXPOSE] Proxy error ${req.method} ${c.req.path}: ${err?.message}`);
        await logAccess({ method: req.method, path: c.req.path, status: 502, durationMs: duration, ip, tool });
        return c.json({ error: "Upstream proxy error", detail: err?.message }, 502);
    }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function waitForWorker(): Promise<void> {
    console.log("[EXPOSE] Waiting for Worker to be ready on :3001...");
    let attempt = 0;
    while (true) {
        try {
            const res = await fetch(`${WORKER_URL}/ping`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                console.log("[EXPOSE] Worker is up — starting Exposure Service");
                return;
            }
        } catch {
            // not ready yet
        }
        attempt++;
        if (attempt % 5 === 0) {
            console.log(`[EXPOSE] Still waiting for Worker... (${attempt * 2}s elapsed)`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

async function boot() {

    // 0. Wait for the worker to be fully started before doing anything
    await waitForWorker();

    // 1. Init DB
    const dbUrl = process.env.WORKER_DATABASE_URL;
    if (!dbUrl) {
        console.error("[EXPOSE] WORKER_DATABASE_URL not set — DB features disabled");
    } else {
        dbPool = mysql2.createPool(dbUrl);
        await initDb();
    }

    // 2. Restore persisted toggle mode
    const saved = (await getConfig("toggle_mode")) as ToggleMode | null;
    if (saved && ["AUTO", "FORCE_ON", "FORCE_OFF"].includes(saved)) {
        toggleMode = saved;
    }

    // 3. Validate security keys
    if (!API_KEY || API_KEY === "CHANGE_ME_generate_a_64_char_hex_key_here") {
        console.warn("[EXPOSE] ⚠  WORKER_API_KEY is not set — remote auth will reject all requests");
    }
    if (!HUD_TOKEN || HUD_TOKEN === "CHANGE_ME_generate_a_32_char_hex_token_here") {
        console.warn("[EXPOSE] ⚠  HUD_TOKEN is not set — HUD internal API will reject all requests");
    }

    // 4. Start HTTP server
    serve({ fetch: app.fetch, port: PORT });

    console.log("");
    console.log("[EXPOSE] ========================================");
    console.log(`[EXPOSE] Internet Exposure Service running on :${PORT}`);
    console.log(`[EXPOSE] Toggle mode: ${toggleMode}`);
    console.log(`[EXPOSE] Auto-expose delay: ${AUTO_DELAY / 60000} min`);
    console.log("[EXPOSE] ========================================");
    console.log("");

    // 5. Apply initial state based on toggle mode
    if (toggleMode === "FORCE_ON") {
        console.log("[EXPOSE] Restored FORCE_ON — starting tunnel immediately");
        await startTunnel();
    } else if (toggleMode === "FORCE_OFF") {
        console.log("[EXPOSE] Restored FORCE_OFF — tunnel will not start");
    } else {
        // AUTO — check if master is already connected
        // Give server.ts a couple of seconds to attempt its first registration
        setTimeout(() => {
            if (connectionState.connected) {
                console.log("[EXPOSE] AUTO — master already connected, staying local");
            } else {
                console.log("[EXPOSE] AUTO — master not yet connected, starting auto-timer");
                startAutoTimer();
            }
        }, 3000);
    }

    // 6. Periodic metrics snapshot to DB (every 60s)
    setInterval(async () => {
        if (!dbPool) return;
        try {
            const si = await import("systeminformation");
            const [graphics, mem, load, temp, network] = await Promise.all([
                si.graphics(),
                si.mem(),
                si.currentLoad(),
                si.cpuTemperature(),
                si.networkStats(),
            ]);
            const gpu = graphics.controllers[0];
            const net = network[0];

            await dbPool.execute(
                `INSERT INTO worker_metrics_snapshots
                 (ts, cpu_pct, ram_gb, gpu_pct, gpu_temp, cpu_temp, rx_bps, tx_bps, active_jobs, is_exposed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
                [
                    Date.now(),
                    Math.round(load.currentLoad),
                    +(mem.used / 1024 / 1024 / 1024).toFixed(2),
                    Math.round(gpu?.utilizationGpu ?? 0),
                    gpu?.temperatureGpu ?? null,
                    temp.main ?? null,
                    net?.rx_sec ?? 0,
                    net?.tx_sec ?? 0,
                    isExposed ? 1 : 0,
                ]
            );
        } catch {
            // Never let snapshot errors crash the process
        }
    }, 60_000);
}

boot().catch(err => {
    console.error("[EXPOSE] Fatal boot error:", err);
    process.exit(1);
});

// Clean shutdown
process.on("SIGINT",  () => { stopTunnel().then(() => process.exit(0)); });
process.on("SIGTERM", () => { stopTunnel().then(() => process.exit(0)); });

process.on("unhandledRejection", (reason) => {
    console.error("[EXPOSE] Unhandled rejection (staying alive):", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[EXPOSE] Uncaught exception (staying alive):", err);
});
