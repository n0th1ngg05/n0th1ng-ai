// api/services/companion.ts
//
// n0th1ng Companion API
// ======================
// The single, dedicated abstraction layer between ESP32 hardware (the
// Companion, ESP32-CAM, and future nodes) and the internal AI backend.
//
// This module is entirely self-contained: it opens its own HTTP + WebSocket
// listener on COMPANION_PORT (default 3005) and does not touch, mount onto,
// or modify boot.ts's main Hono app, its routes, or its port. Wiring it in
// is exactly one line in boot.ts:
//
//     import { startCompanionService } from "./services/companion";
//     startCompanionService();
//
// If this file throws or the port is taken, it will not take the main app
// down with it — start() catches and logs.
//
// Everything below is a THIN LAYER over already-existing systems:
//   - speechManager            (speech/manager/speechManager.ts)  -> TTS/STT, health
//   - runtimeManager           (services/runtime/manager.ts)      -> python runtime status
//   - getWorkers()             (services/cluster.ts)              -> distributed GPU workers
//   - getDb()/systemSnapshots  (queries/connection.ts)            -> telemetry history
//   - getRunningModels()       (services/ollamaControl.ts)        -> active Ollama model
//   - generationJobs           (services/generationState.ts)      -> image gen status
//   - deviceRegistry           (services/companion/registry.ts)   -> runtime device state
//
// No new AI/telemetry/speech logic is implemented here — only translation
// between "ESP32 wants X" and "backend already knows how to give X".

import { createServer, type Server as HttpServer, type IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";

import { getSpeechManager } from "../speech/lazy-speech-manager";
import { WavUtil } from "../speech/audio/wav";
import { runtimeManager } from "./runtime/manager";
import { getWorkers } from "./cluster";
import { getRunningModels } from "./ollamaControl";
import { generationJobs } from "./generationState";
import { getDb } from "../queries/connection";
import { systemSnapshots } from "@db/schema";
import { desc } from "drizzle-orm";

import {
    deviceRegistry,
    type DeviceType,
    type RuntimeDevice,
} from "./companion/registry";

const COMPANION_PORT = Number(process.env.COMPANION_PORT || 3005);
const SERVER_VERSION = "1.0.0";
const HEARTBEAT_INTERVAL_MS = 15_000;

// The Companion's voice is fixed, not device-configurable. Every voice
// response — regardless of what any individual ESP32 sends — goes through
// Kokoro / af_sarah. This is intentional: the hardware should not be able
// to pick a provider or voice, only the backend decides.
const COMPANION_SPEECH_PROVIDER_ID = "kokoro";
const COMPANION_SPEECH_VOICE_ID = "af_sarah";

// The Companion's LLM is fixed too — same reasoning as the voice above.
// The device never picks the model; it only ever gets gemma3:4b answers.
const COMPANION_LLM_MODEL = "gemma3:4b";

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────

function json(res: any, status: number, body: any) {
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, X-Device-Id, X-API-Key",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            if (!raw) return resolve(null);
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve(null);
            }
        });
        req.on("error", () => resolve(null));
    });
}

function serializeDevice(d: RuntimeDevice) {
    return {
        id: d.id,
        deviceType: d.deviceType,
        friendlyName: d.friendlyName,
        registered: d.registered,
        online: d.online,
        connectionState: d.connectionState,
        firmwareVersion: d.firmwareVersion,
        hardwareRevision: d.hardwareRevision,
        ip: d.ip,
        rssi: d.rssi,
        capabilities: d.capabilities,
        uptimeMs: d.bootTimestamp ? Date.now() - d.bootTimestamp : null,
        lastHeartbeat: d.lastHeartbeat,
        currentActivity: d.currentActivity,
        currentRequests: d.currentRequests,
        activeSessions: d.activeSessions,
        runtimeStats: d.runtimeStats,
        connectionStats: d.connectionStats,
        eventHistory: d.eventHistory,
        errorHistory: d.errorHistory,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Weather — backend is the single provider; caches and fans out over WS
// ─────────────────────────────────────────────────────────────────────────

interface WeatherSnapshot {
    city: string;
    state?: string;
    country?: string;
    tempC: number;
    feelsLikeC: number;
    humidity: number;
    pressure: number;
    windKph: number;
    condition: string;
    icon: string;
    forecast: any[];
    fetchedAt: number;
}

let weatherCache: WeatherSnapshot | null = null;
const WEATHER_TTL_MS = 10 * 60 * 1000; // 10 minutes
const WEATHER_LAT = process.env.COMPANION_WEATHER_LAT;
const WEATHER_LON = process.env.COMPANION_WEATHER_LON;
const OPENWEATHER_KEY = process.env.OPENWEATHER_API_KEY;

async function refreshWeather(): Promise<WeatherSnapshot | null> {
    if (!OPENWEATHER_KEY || !WEATHER_LAT || !WEATHER_LON) {
        return weatherCache; // Not configured — leave whatever we last had (may be null)
    }

    try {
        const url =
            `https://api.openweathermap.org/data/2.5/weather?lat=${WEATHER_LAT}&lon=${WEATHER_LON}` +
            `&units=metric&appid=${OPENWEATHER_KEY}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`OpenWeatherMap returned ${res.status}`);
        const data: any = await res.json();

        weatherCache = {
            city: data.name,
            country: data.sys?.country,
            tempC: data.main?.temp,
            feelsLikeC: data.main?.feels_like,
            humidity: data.main?.humidity,
            pressure: data.main?.pressure,
            windKph: data.wind?.speed ? data.wind.speed * 3.6 : 0,
            condition: data.weather?.[0]?.main ?? "Unknown",
            icon: data.weather?.[0]?.icon ?? "",
            forecast: [],
            fetchedAt: Date.now(),
        };

        broadcast({ type: "weather_update", payload: weatherCache });
    } catch (err) {
        console.error("[COMPANION] Weather refresh failed:", err);
    }

    return weatherCache;
}

async function getWeather(): Promise<WeatherSnapshot | null> {
    if (weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_TTL_MS) {
        return weatherCache;
    }
    return refreshWeather();
}

// ─────────────────────────────────────────────────────────────────────────
// AI / Companion status — pulled from existing runtime/speech/cluster state
// ─────────────────────────────────────────────────────────────────────────

async function buildStatusReport() {
    const [runningModels, health, workers] = await Promise.all([
        getRunningModels().catch(() => null),
        (await getSpeechManager()).healthManager.getHealthReport().catch(() => null),
        Promise.resolve(getWorkers()),
    ]);

    const pyStatus = runtimeManager.status();
    const activeJobs = [...generationJobs.values()].filter(
        (j) => j.status !== "completed" && j.status !== "failed"
    );

    return {
        backendOnline: true,
        aiReady: !!pyStatus.python,
        activeModel: runningModels?.models?.[0]?.name ?? null,
        voiceEngineStatus: health?.overall ?? "unknown",
        imageEngineStatus: activeJobs.length > 0 ? "busy" : "idle",
        gpuWorkers: workers.map((w) => ({
            hostname: w.hostname,
            online: w.online,
            health: w.health,
            currentJobs: w.currentJobs,
        })),
        queueLength: activeJobs.length,
        currentJobs: activeJobs.map((j) => ({
            id: j.id,
            status: j.status,
            progress: j.progress,
            prompt: j.prompt,
        })),
        serverUptimeSec: process.uptime(),
        timestamp: Date.now(),
    };
}

async function buildTelemetryReport() {
    const db = getDb();
    const latest = await db.query.systemSnapshots.findFirst({
        orderBy: [desc(systemSnapshots.createdAt)],
    });
    return latest ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// WebSocket: connection registry + broadcast
// ─────────────────────────────────────────────────────────────────────────

interface CompanionSocket extends WebSocket {
    deviceId?: string;
    voiceChunks?: Buffer[];       // accumulated base64-decoded PCM chunks for an in-progress streamed voice_audio
    voiceStreamFormat?: string;
    voiceStreamSampleRate?: number;
}

const sockets = new Map<string, CompanionSocket>();

function send(ws: CompanionSocket, type: string, payload: any) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
        if (ws.deviceId) deviceRegistry.recordMessageOut(ws.deviceId);
    } catch (err) {
        console.error("[COMPANION] WS send failed:", err);
    }
}

function broadcast(msg: { type: string; payload: any }) {
    for (const ws of sockets.values()) send(ws, msg.type, msg.payload);
}

interface ChatPipelineOptions {
    prompt: string;
    useRag?: boolean;
    conversationId?: string | number;
    voice: boolean;
}

// Drives a prompt through the exact same pipeline every other client uses
// (routing/tools/RAG/memory/streaming-TTS all live in /api/chat/stream —
// this just proxies it over the WebSocket instead of duplicating any of
// that logic here). Each NDJSON line from the backend is forwarded to the
// ESP32 the moment it arrives, so audio starts playing on-device well
// before the full LLM response has finished generating.
async function runChatPipeline(ws: CompanionSocket, opts: ChatPipelineOptions) {
    const device = ws.deviceId ? deviceRegistry.getOne(ws.deviceId) : undefined;
    if (device) device.currentActivity = "thinking";

    try {
        const resp = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/chat/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt: opts.prompt,
                model: COMPANION_LLM_MODEL,
                useRag: opts.useRag ?? true,
                conversationId: opts.conversationId,
                mode: opts.voice ? "voice" : "text",
                responseMode: opts.voice ? "voice" : "text",
                // Hardcoded — the Companion's voice is fixed, never taken
                // from the device or per-request payload.
                providerId: opts.voice ? COMPANION_SPEECH_PROVIDER_ID : undefined,
                voiceId: opts.voice ? COMPANION_SPEECH_VOICE_ID : undefined,
            }),
        });

        if (!resp.ok || !resp.body) {
            send(ws, "error", { message: `AI backend returned ${resp.status}` });
            return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                if (!line.trim()) continue;

                let parsed: any;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    continue;
                }

                if (parsed.error) {
                    send(ws, "error", { message: String(parsed.error) });
                    continue;
                }

                if (parsed.response) {
                    fullText += parsed.response;
                    send(ws, "ai_token", { text: parsed.response });
                }

                if (parsed.thinking) {
                    send(ws, "ai_thinking", { text: parsed.thinking });
                }

                // Streaming TTS chunk — { sequence, audio (base64 PCM),
                // format, sampleRate, duration, voice }. Forwarded as-is;
                // the ESP32 plays each chunk through the MAX98357A in
                // sequence order as it arrives.
                if (parsed.speech) {
                    if (device) device.currentActivity = "speaking";
                    send(ws, "voice_stream", parsed.speech);
                }
            }
        }

        send(ws, "ai_response", { text: fullText });
        if (opts.voice) send(ws, "voice_stream_end", { reason: "complete" });
    } catch (err) {
        console.error("[COMPANION] chat pipeline failed:", err);
        send(ws, "error", { message: "AI backend unreachable" });
    } finally {
        if (device) device.currentActivity = null;
    }
}

async function runVoicePipeline(
    ws: CompanionSocket,
    device: RuntimeDevice | undefined,
    audioBuffer: Buffer,
    format: string,
    sampleRate: number,
    payload: any,
) {
    // The ESP32 companion streams raw headerless 16-bit mono PCM. The
    // whisper worker's /stt endpoint expects a self-describing container
    // (WAV) — raw PCM with no header causes it to fail decoding audio and
    // return a 500. Wrap it in a proper WAV header here rather than
    // sending it raw; the whisper provider itself is left untouched.
    let sttAudio = audioBuffer;
    let sttFormat = format;
    if (format === "pcm") {
        sttAudio = WavUtil.buildWav(audioBuffer, {
            sampleRate,
            channels: 1,
            bitDepth: 16,
            format: "pcm",
        });
        sttFormat = "wav";
    }

    let transcript = "";
    try {
        const mgr = await getSpeechManager();
        const stt = await mgr.transcribe({
            audioData: sttAudio,
            format: sttFormat,
            sampleRate,
            providerId: payload?.providerId ?? "whisper",
        });
        transcript = stt.text ?? "";
        send(ws, "voice_transcript", stt);
    } catch (err) {
        console.error("[COMPANION] voice transcription failed:", err);
        send(ws, "error", { message: "Transcription failed" });
        if (device) device.currentActivity = null;
        return;
    }

    if (!transcript.trim()) {
        if (device) device.currentActivity = null;
        send(ws, "voice_stream_end", { reason: "empty_transcript" });
        return;
    }

    // Note: TTS provider/voice AND the LLM model are NOT taken from
    // payload here — runChatPipeline() hardcodes Kokoro / af_sarah and
    // gemma3:4b for every Companion request, regardless of what the
    // device sends.
    await runChatPipeline(ws, {
        prompt: transcript,
        useRag: payload?.useRag,
        conversationId: payload?.conversationId,
        voice: true,
    });
}

async function handleWsMessage(ws: CompanionSocket, raw: string) {
    let msg: any;
    try {
        msg = JSON.parse(raw);
    } catch {
        send(ws, "error", { message: "Invalid JSON" });
        return;
    }

    const { type, payload } = msg ?? {};
    if (!type) return;

    if (ws.deviceId) deviceRegistry.recordMessageIn(ws.deviceId);

    switch (type) {
        case "register": {
            const device = deviceRegistry.register({
                id: payload?.deviceId,
                deviceType: (payload?.deviceType as DeviceType) ?? "esp32_companion",
                friendlyName: payload?.deviceName,
                firmwareVersion: payload?.firmwareVersion,
                hardwareRevision: payload?.hardwareRevision,
                ip: payload?.ip,
                rssi: payload?.rssi,
                capabilities: payload?.capabilities,
                bootTimestamp: payload?.bootTimestamp ?? Date.now(),
            });

            ws.deviceId = device.id;
            sockets.set(device.id, ws);

            send(ws, "register_ack", {
                success: true,
                friendlyName: device.friendlyName,
                serverVersion: SERVER_VERSION,
                backendVersion: SERVER_VERSION,
                serverTime: Date.now(),
                featureFlags: {
                    voice: true,
                    camera: true,
                    weather: !!OPENWEATHER_KEY,
                    notifications: true,
                    ota: true,
                },
            });

            broadcast({ type: "device_connected", payload: serializeDevice(device) });
            break;
        }

        case "heartbeat": {
            if (!ws.deviceId) return;
            deviceRegistry.heartbeat(ws.deviceId, {
                rssi: payload?.rssi,
                currentActivity: payload?.currentActivity,
                ip: payload?.ip,
            });
            send(ws, "heartbeat_ack", { serverTime: Date.now() });
            break;
        }

        case "status_request": {
            send(ws, "ai_status", await buildStatusReport());
            break;
        }

        case "telemetry_request": {
            send(ws, "telemetry_update", await buildTelemetryReport());
            break;
        }

        case "weather_request": {
            send(ws, "weather_update", await getWeather());
            break;
        }

        case "ai_prompt": {
            // Text-in path (e.g. a typed/serial debug prompt, or a future
            // touchscreen). No audio involved, so this streams text tokens
            // only — no TTS. For the voice path see "voice_audio" below.
            if (!ws.deviceId) return;
            await runChatPipeline(ws, {
                prompt: payload?.prompt,
                useRag: payload?.useRag,
                conversationId: payload?.conversationId,
                voice: false,
            });
            break;
        }

        case "voice_audio_chunk": {
            // Streamed audio: device sends many small base64 PCM chunks as
            // it captures them, instead of buffering a whole utterance
            // on-device first. We just accumulate raw bytes here — cheap,
            // since server RAM isn't remotely as constrained as the ESP32's.
            if (!ws.deviceId || !payload?.audio) return;
            if (!ws.voiceChunks) {
                ws.voiceChunks = [];
                ws.voiceStreamFormat = payload.format ?? "pcm";
                ws.voiceStreamSampleRate = payload.sampleRate ?? 16000;
                const device = deviceRegistry.getOne(ws.deviceId);
                if (device) device.currentActivity = "listening";
            }
            try {
                ws.voiceChunks.push(Buffer.from(payload.audio, "base64"));
            } catch (err) {
                console.error("[COMPANION] voice_audio_chunk decode failed:", err);
            }
            break;
        }

        case "voice_audio_end": {
            // End of a streamed utterance: join accumulated chunks and run
            // through the exact same STT -> LLM -> TTS pipeline as the
            // single-shot path below.
            if (!ws.deviceId) return;
            const device = deviceRegistry.getOne(ws.deviceId);
            const chunks = ws.voiceChunks;
            const format = ws.voiceStreamFormat ?? "pcm";
            const sampleRate = ws.voiceStreamSampleRate ?? 16000;
            ws.voiceChunks = undefined;
            ws.voiceStreamFormat = undefined;
            ws.voiceStreamSampleRate = undefined;

            if (!chunks || chunks.length === 0) {
                if (device) device.currentActivity = null;
                send(ws, "voice_stream_end", { reason: "empty_transcript" });
                return;
            }

            const audioBuffer = Buffer.concat(chunks);
            await runVoicePipeline(ws, device, audioBuffer, format, sampleRate, payload);
            break;
        }

        case "voice_audio": {
            // Single-shot path: whole utterance sent as one base64 blob in
            // one message. Kept for backward compatibility / non-streaming
            // clients; streaming clients should use voice_audio_chunk +
            // voice_audio_end instead, which is far lighter on device RAM.
            if (!ws.deviceId || !payload?.audio) return;
            const device = deviceRegistry.getOne(ws.deviceId);
            if (device) device.currentActivity = "listening";

            let audioBuffer: Buffer;
            try {
                audioBuffer = Buffer.from(payload.audio, "base64");
            } catch (err) {
                console.error("[COMPANION] voice_audio decode failed:", err);
                send(ws, "error", { message: "Invalid audio payload" });
                if (device) device.currentActivity = null;
                return;
            }

            await runVoicePipeline(ws, device, audioBuffer, payload.format ?? "wav", payload.sampleRate ?? 16000, payload);
            break;
        }

        case "notification_ack": {
            // Companion confirming it displayed a pushed notification.
            if (ws.deviceId) deviceRegistry.pushEvent(deviceRegistry.getOne(ws.deviceId)!, "notification_ack", payload);
            break;
        }

        default: {
            deviceRegistry.recordError(ws.deviceId ?? "unknown", "unknown_message_type", { type });
            send(ws, "error", { message: `Unknown message type: ${type}` });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────
// REST endpoints (boot / config / one-off requests / browser debugging)
// ─────────────────────────────────────────────────────────────────────────

async function handleRest(req: IncomingMessage, res: any, pathname: string, query: URLSearchParams) {
    const method = req.method ?? "GET";

    if (method === "OPTIONS") {
        return json(res, 204, {});
    }

    // ── Browser-friendly / debugging endpoints ─────────────────────────
    if (pathname === "/" || pathname === "/api/companion/info") {
        return json(res, 200, {
            service: "n0th1ng Companion API",
            version: SERVER_VERSION,
            port: COMPANION_PORT,
            endpoints: ["/health", "/status", "/devices", "/devices/:id", "/diagnostics"],
            websocket: "/ws",
        });
    }

    if (pathname === "/health") {
        return json(res, 200, { ok: true, uptimeSec: process.uptime(), timestamp: Date.now() });
    }

    if (pathname === "/status") {
        return json(res, 200, await buildStatusReport());
    }

    if (pathname === "/devices" && method === "GET") {
        return json(res, 200, {
            summary: deviceRegistry.summary(),
            devices: deviceRegistry.getAll().map(serializeDevice),
        });
    }

    const deviceMatch = pathname.match(/^\/devices\/([^/]+)$/);
    if (deviceMatch && method === "GET") {
        const device = deviceRegistry.getOne(decodeURIComponent(deviceMatch[1]));
        if (!device) return json(res, 404, { error: "Device not found" });
        return json(res, 200, serializeDevice(device));
    }

    if (pathname === "/diagnostics") {
        return json(res, 200, {
            uptimeSec: process.uptime(),
            memory: process.memoryUsage(),
            connectedSockets: sockets.size,
            devices: deviceRegistry.summary(),
            weatherCached: !!weatherCache,
            nodeVersion: process.version,
        });
    }

    // ── ESP32-facing one-off REST endpoints ─────────────────────────────
    if (pathname === "/api/companion/register" && method === "POST") {
        const body = await readBody(req);
        if (!body?.deviceId) return json(res, 400, { error: "deviceId required" });

        const device = deviceRegistry.register({
            id: body.deviceId,
            deviceType: body.deviceType ?? "esp32_companion",
            friendlyName: body.deviceName,
            firmwareVersion: body.firmwareVersion,
            hardwareRevision: body.hardwareRevision,
            ip: body.ip,
            rssi: body.rssi,
            capabilities: body.capabilities,
            bootTimestamp: body.bootTimestamp ?? Date.now(),
        });

        return json(res, 200, {
            success: true,
            friendlyName: device.friendlyName,
            serverVersion: SERVER_VERSION,
            backendVersion: SERVER_VERSION,
            serverTime: Date.now(),
            featureFlags: {
                voice: true,
                camera: true,
                weather: !!OPENWEATHER_KEY,
                notifications: true,
                ota: true,
            },
        });
    }

    if (pathname === "/api/companion/weather" && method === "GET") {
        return json(res, 200, (await getWeather()) ?? { error: "Weather not configured" });
    }

    if (pathname === "/api/companion/status" && method === "GET") {
        return json(res, 200, await buildStatusReport());
    }

    if (pathname === "/api/companion/telemetry" && method === "GET") {
        return json(res, 200, await buildTelemetryReport());
    }

    if (pathname === "/api/companion/settings" && method === "GET") {
        const deviceId = query.get("deviceId");
        if (!deviceId) return json(res, 400, { error: "deviceId required" });
        const device = deviceRegistry.getOne(deviceId);
        return json(res, 200, device?.settings ?? {});
    }

    if (pathname === "/api/companion/settings" && method === "POST") {
        const body = await readBody(req);
        if (!body?.deviceId) return json(res, 400, { error: "deviceId required" });
        const device = deviceRegistry.setSettings(body.deviceId, body.settings ?? {});
        if (!device) return json(res, 404, { error: "Device not found" });
        broadcast({ type: "settings_changed", payload: { deviceId: body.deviceId, settings: device.settings } });
        return json(res, 200, { success: true, settings: device.settings });
    }

    if (pathname === "/api/companion/ota" && method === "GET") {
        return json(res, 200, {
            currentVersion: query.get("current") ?? null,
            latestVersion: process.env.COMPANION_FW_LATEST ?? null,
            updateUrl: process.env.COMPANION_FW_URL ?? null,
            releaseNotes: process.env.COMPANION_FW_NOTES ?? null,
            checksum: process.env.COMPANION_FW_CHECKSUM ?? null,
        });
    }

    if (pathname === "/api/companion/notify" && method === "POST") {
        // Internal-facing: other backend services call this to push a
        // notification out to all (or one) connected Companion device.
        const body = await readBody(req);
        if (!body?.title) return json(res, 400, { error: "title required" });

        const msg = { type: "notification", payload: body };
        if (body.deviceId) {
            const ws = sockets.get(body.deviceId);
            if (ws) send(ws, "notification", body);
        } else {
            broadcast(msg);
        }
        return json(res, 200, { success: true });
    }

    return json(res, 404, { error: "Not Found" });
}

// ─────────────────────────────────────────────────────────────────────────
// Server bootstrap
// ─────────────────────────────────────────────────────────────────────────

let httpServer: HttpServer | null = null;
let wss: WebSocketServer | null = null;

export function startCompanionService() {
    if (httpServer) return; // idempotent — safe to call more than once

    try {
        httpServer = createServer(async (req, res) => {
            try {
                const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
                await handleRest(req, res, url.pathname, url.searchParams);
            } catch (err) {
                console.error("[COMPANION] REST handler error:", err);
                json(res, 500, { error: "Internal Companion API error" });
            }
        });

        wss = new WebSocketServer({ server: httpServer, path: "/ws" });

        wss.on("connection", (ws: CompanionSocket) => {
            console.log("[COMPANION] WebSocket client connected");

            ws.on("message", (data) => {
                handleWsMessage(ws, data.toString()).catch((err) => {
                    console.error("[COMPANION] WS message handler error:", err);
                });
            });

            ws.on("close", () => {
                ws.voiceChunks = undefined;
                if (ws.deviceId) {
                    deviceRegistry.disconnect(ws.deviceId, "ws_close");
                    sockets.delete(ws.deviceId);
                    broadcast({ type: "device_disconnected", payload: { deviceId: ws.deviceId } });
                    console.log(`[COMPANION] Device disconnected: ${ws.deviceId}`);
                }
            });

            ws.on("error", (err) => {
                if (ws.deviceId) deviceRegistry.recordError(ws.deviceId, "ws_error", String(err));
                console.error("[COMPANION] WebSocket error:", err);
            });
        });

        httpServer.on("error", (err) => {
            console.error(`[COMPANION] Failed to start on port ${COMPANION_PORT}:`, err);
        });

        httpServer.listen(COMPANION_PORT, () => {
            console.log(`[COMPANION] Companion API listening on http://0.0.0.0:${COMPANION_PORT} (REST + WS at /ws)`);
        });

        // Periodic server -> device heartbeat + weather refresh, independent
        // of whatever cadence individual devices choose to heartbeat at.
        setInterval(() => {
            broadcast({ type: "heartbeat", payload: { serverTime: Date.now() } });
        }, HEARTBEAT_INTERVAL_MS);

        setInterval(() => {
            refreshWeather().catch(() => {});
        }, WEATHER_TTL_MS);
    } catch (err) {
        // Never let a Companion API failure take the main backend down.
        console.error("[COMPANION] Failed to initialize Companion service:", err);
    }
}

export function stopCompanionService() {
    wss?.close();
    httpServer?.close();
    httpServer = null;
    wss = null;
}

// Exposed for other backend services (e.g. a notification dispatcher
// elsewhere in the app) that want to push to Companions without going
// through HTTP.
export { broadcast as broadcastToCompanions, deviceRegistry as companionDeviceRegistry };