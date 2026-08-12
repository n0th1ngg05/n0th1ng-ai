# n0th1ng Companion — Frontend Build Spec

Hand this whole document to the AI building the frontend. It describes an
**already-built, already-running backend** — do not invent, rename, or
"improve" any endpoint, field name, or message type below. If something
seems missing, flag it as a question rather than guessing a new shape.

---

## 0. Project layout

```
app/
  api/                    <- Node backend (Hono + tRPC), NOT part of this task
  api/services/           <- includes services/companion.ts + services/companion/registry.ts
  frontend/                <- YOU build this. Plain HTML, CSS, JS. No framework, no build step.
```

Output should be static files under `app/frontend/` — e.g. `index.html`,
`styles.css` (or a few CSS files), and `js/` modules — that can be opened
directly or served by any static file server. No React/Vue/bundler unless
explicitly asked for later.

---

## 1. What this frontend is for

A **dashboard for the n0th1ng AI backend and its connected hardware**
(currently one ESP32 "Companion" device with a mic + speaker; more device
types will be added later without changing this API). It is a browser
client — it talks to the Companion API the exact same way the ESP32 does,
over REST + WebSocket, just from a browser instead of firmware.

The frontend has two jobs:

1. **Admin/monitoring dashboard** — device list, live status, telemetry,
   weather, event/error history, backend health.
2. **A browser-based voice/text chat client for the Companion pipeline** —
   type or speak into the browser, get the same STT → LLM → TTS pipeline
   the ESP32 gets, hear the audio play back, in real time.

This is explicitly the "Browser Accessibility" requirement from the backend
spec: everything the ESP32 can do, a browser should be able to inspect and
debug too.

---

## 2. Network basics

- **Companion API base URL:** `http://<backend-host>:3005` (port is
  configurable server-side via `COMPANION_PORT`, default `3005`). Make the
  base URL configurable in the frontend (a settings field or a constant at
  the top of a `config.js`) — do not hardcode `localhost` only.
- **REST:** plain JSON over HTTP. CORS is already open (`Access-Control-Allow-Origin: *`)
  from the backend, so this works cross-origin from any host serving the
  frontend.
- **WebSocket:** `ws://<backend-host>:3005/ws` (or `wss://` if TLS is added
  later — don't hardcode the scheme, derive it from the page's protocol or a
  config value).
- All WS messages, both directions, are JSON text frames shaped as:
  ```json
  { "type": "<event_name>", "payload": { ... }, "ts": 1737000000000 }
  ```
  `ts` is only present on **server → client** messages (server-set send
  timestamp, ms epoch). Client → server messages just need `type` and
  `payload`.

---

## 3. REST endpoints (exact, do not rename)

All responses are `application/json`.

| Method | Path                          | Purpose                                                                 |
|--------|-------------------------------|--------------------------------------------------------------------------|
| GET    | `/` or `/api/companion/info`  | Service metadata: name, version, port, list of endpoints                |
| GET    | `/health`                     | `{ ok: true, uptimeSec, timestamp }` — liveness check                   |
| GET    | `/status`                     | Full AI/backend status report (see §5)                                  |
| GET    | `/devices`                    | `{ summary, devices: [...] }` — all registered devices (see §4)         |
| GET    | `/devices/:id`                | One device by id (MAC/device id). 404 if not found                      |
| GET    | `/diagnostics`                | Process uptime, memory, connected socket count, device summary          |
| POST   | `/api/companion/register`     | REST fallback for device registration (WS `register` is preferred)      |
| GET    | `/api/companion/weather`      | Cached weather snapshot (see §6), or `{ error }` if not configured      |
| GET    | `/api/companion/status`       | Same payload as `/status`                                               |
| GET    | `/api/companion/telemetry`    | Latest single telemetry snapshot (see §7)                               |
| GET    | `/api/companion/settings?deviceId=<id>` | Per-device settings object (arbitrary key/value)               |
| POST   | `/api/companion/settings`     | Body `{ deviceId, settings: {...} }` — merges into device settings      |
| GET    | `/api/companion/ota?current=<version>` | OTA info: latestVersion, updateUrl, releaseNotes, checksum      |
| POST   | `/api/companion/notify`       | Body `{ title, ...anything, deviceId? }` — push a notification (mainly for other backend services, but usable from an admin UI to test notifications) |

`OPTIONS` is supported on all routes (204, for CORS preflight) — nothing
special needed frontend-side, fetch() handles it automatically.

---

## 4. Device shape

This exact shape is returned by `/devices`, `/devices/:id`, and is what
`device_connected` / `device_disconnected` WS events reference:

```ts
interface Device {
  id: string;                    // MAC address or stable hardware id
  deviceType:
    | "esp32_companion" | "esp32_cam" | "lora_node"
    | "ble_node" | "sensor_node" | "automation_controller" | "unknown";
  friendlyName: string;
  registered: boolean;
  online: boolean;
  connectionState: "connected" | "disconnected" | "reconnecting";
  firmwareVersion?: string;
  hardwareRevision?: string;
  ip?: string;
  rssi?: number;
  capabilities: string[];        // e.g. ["telemetry","voice","camera"]
  uptimeMs: number | null;       // null if bootTimestamp unknown
  lastHeartbeat: number;         // ms epoch
  currentActivity: string | null; // "listening" | "thinking" | "speaking" | null (freeform, treat as string)
  currentRequests: number;
  activeSessions: string[];
  runtimeStats: {
    uptimeMs: number;
    messagesReceived: number;
    messagesSent: number;
  };
  connectionStats: {
    totalConnections: number;
    totalDisconnections: number;
    totalReconnects: number;
    lastDisconnectReason?: string;
  };
  eventHistory: { ts: number; type: string; detail?: any }[];  // ring buffer, max 50
  errorHistory: { ts: number; type: string; detail?: any }[];  // ring buffer, max 50
  settings?: Record<string, any>;
}
```

`/devices` wraps this in:
```json
{
  "summary": {
    "total": 1, "online": 1, "offline": 0,
    "byType": { "esp32_companion": 1 }
  },
  "devices": [ /* Device[] */ ]
}
```

**Devices page requirement:** build this generically off `deviceType` +
`capabilities` so a future `esp32_cam` or `lora_node` just shows up with
sensible defaults, no code changes needed. Don't hardcode UI only for
`esp32_companion`.

---

## 5. AI/backend status shape (`/status`, `ai_status` WS event)

```ts
interface StatusReport {
  backendOnline: boolean;
  aiReady: boolean;
  activeModel: string | null;
  voiceEngineStatus: string;   // "healthy" | "degraded" | "unhealthy" | "unknown"
  imageEngineStatus: "idle" | "busy";
  gpuWorkers: {
    hostname: string;
    online: boolean;
    health: { cpu: number; ram: number; gpu: number };
    currentJobs: number;
  }[];
  queueLength: number;
  currentJobs: {
    id: string;
    status: "queued" | "loading" | "sampling" | "saving" | "completed" | "failed";
    progress: number;
    prompt: string;
  }[];
  serverUptimeSec: number;
  timestamp: number;
}
```

---

## 6. Weather shape (`/api/companion/weather`, `weather_update` WS event)

```ts
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
  icon: string;        // OpenWeatherMap icon code, e.g. "04d"
  forecast: any[];     // currently always empty — don't build UI depending on forecast data yet
  fetchedAt: number;   // ms epoch of when this was fetched, cached ~10 min
}
```
If weather isn't configured server-side you'll get `{ "error": "Weather not configured" }` instead — handle that gracefully (hide the widget or show "not configured"), don't treat it as a network failure.

---

## 7. Telemetry shape (`/api/companion/telemetry`, `telemetry_update` WS event)

This is a raw row from the backend's `systemSnapshots` table — treat fields
defensively (some may be null) and don't assume every field below is
guaranteed non-null:

```ts
interface TelemetrySnapshot {
  cpuUsage: number;        // %
  cpuTemp: number;         // °C
  ramUsage: number;        // %
  ramTotal: number;        // bytes
  gpuUsage: number;        // %
  gpuTemp: number | null;  // °C
  vramUsage: number;       // MB
  vramTotal: number;       // MB
  storageUsage: number;    // %
  networkRx: number;       // cumulative bytes
  networkTx: number;       // cumulative bytes
  networkRxSpeed: number;  // bytes/sec
  networkTxSpeed: number;  // bytes/sec
  createdAt: string;       // timestamp
}
```

---

## 8. WebSocket protocol — full event catalogue

### 8.1 Client → Server (things the browser/frontend sends)

| type               | payload                                                                 | Purpose |
|--------------------|--------------------------------------------------------------------------|---------|
| `register`         | `{ deviceId, deviceType?, deviceName?, firmwareVersion?, hardwareRevision?, ip?, rssi?, capabilities?, bootTimestamp? }` | Register this connection as a device. **Do this immediately on WS open.** For a browser client, use a stable generated id (e.g. persisted in localStorage) and `deviceType: "unknown"` or a new type if you want to distinguish browser clients — see §10. |
| `heartbeat`        | `{ rssi?, currentActivity?, ip? }`                                       | Keep-alive + activity update. Send periodically (e.g. every 10–15s) — server sweeps devices offline after 30s without one. |
| `status_request`   | `{}`                                                                      | Ask for an immediate `ai_status` response |
| `telemetry_request`| `{}`                                                                      | Ask for an immediate `telemetry_update` response |
| `weather_request`  | `{}`                                                                      | Ask for an immediate `weather_update` response |
| `ai_prompt`        | `{ prompt, model?, useRag?, conversationId? }`                          | Text-only chat — streams back `ai_token` / `ai_thinking` / `ai_response`. **No audio.** |
| `voice_audio`      | `{ audio: <base64>, format?, sampleRate?, providerId?, model?, useRag?, conversationId? }` | Full voice pipeline: STT → LLM → TTS. `format` defaults to `"wav"`, `sampleRate` defaults to `16000`. `providerId` here is the **STT** provider only (defaults to `"whisper"`) — it has no effect on the TTS voice, which is hardcoded server-side (see §9). |
| `notification_ack` | anything                                                                  | Confirms a pushed `notification` was shown/handled |

### 8.2 Server → Client (things the frontend must listen for)

| type                  | payload                                          | Meaning |
|-----------------------|---------------------------------------------------|---------|
| `register_ack`        | `{ success, friendlyName, serverVersion, backendVersion, serverTime, featureFlags: { voice, camera, weather, notifications, ota } }` | Registration confirmed. Use `featureFlags` to conditionally show UI (e.g. hide weather widget if `featureFlags.weather` is false). |
| `heartbeat_ack`        | `{ serverTime }`                                  | Response to your heartbeat |
| `heartbeat`            | `{ serverTime }`                                  | **Unsolicited**, sent by server to ALL connected clients every 15s. Use this as a liveness signal even if you never call `heartbeat` yourself. |
| `ai_status`            | `StatusReport` (§5)                               | In response to `status_request`, or proactively pushed later |
| `telemetry_update`     | `TelemetrySnapshot` (§7)                          | In response to `telemetry_request` |
| `weather_update`       | `WeatherSnapshot` (§6)                            | In response to `weather_request`, or pushed automatically on refresh (~every 10 min) |
| `ai_token`             | `{ text }`                                        | One streamed token/chunk of the LLM's text response. Append to a running buffer to render live. |
| `ai_thinking`          | `{ text }`                                        | Model's reasoning/thinking trace, if the model supports it. Render separately from the main answer (e.g. collapsible "thinking..." block), don't mix into the answer text. |
| `ai_response`          | `{ text }`                                        | Full final text, sent once the stream completes (a convenience — you can also just accumulate `ai_token`s yourself) |
| `voice_stream`         | `{ sequence, audio: <base64 PCM>, format, sampleRate, duration, voice }` | One synthesized sentence of audio, arrives progressively **during** generation, not all at once. `sequence` is the order to play them in — chunks can arrive slightly out of order over the network, so buffer and play by `sequence`, don't just play-on-arrival if order matters to you. |
| `voice_stream_end`     | `{ reason: "complete" \| "empty_transcript" }`     | No more audio coming for this turn. Use to reset "speaking" UI state. |
| `voice_transcript`     | STT result object (at minimum has `.text`)         | The transcribed text of what was said, sent before the LLM/TTS pipeline starts |
| `notification`         | `{ title, ...anything }`                           | Unsolicited push notification from the backend (AI finished, GPU temp warning, etc — see full list in §11). Show as a toast/banner. |
| `settings_changed`     | `{ deviceId, settings }`                           | Broadcast whenever any client updates a device's settings via REST — sync your local view if it's about the currently-viewed device |
| `device_connected`     | `Device` (§4)                                      | A device (any device, not just yours) just registered — refresh your device list live |
| `device_disconnected`  | `{ deviceId }`                                     | A device disconnected — mark it offline in your device list live |
| `error`                | `{ message }`                                      | Something went wrong — show it, don't ignore it |

---

## 9. IMPORTANT: voice is hardcoded server-side

The TTS provider and voice are **fixed in the backend** — `kokoro` /
`af_sarah` — and cannot be changed per-request. **Do not build any UI for
selecting a voice or TTS provider.** If you want to display which voice is
active (e.g. in a footer or settings panel, informational only, non-editable),
that's fine, but there is no API to change it. `POST /api/companion/settings`
exists for other per-device preferences (theme, volume, etc.) — voice is
intentionally not one of them.

---

## 10. Suggested pages/screens

Build these as logical sections (single-page app is fine, or separate HTML
files with shared CSS/JS — your call, just keep it plain HTML/CSS/JS, no
framework):

1. **Dashboard / Overview**
   - Backend status card (`ai_status`): online/ready badges, active model,
     voice/image engine status, GPU worker list, queue length.
   - Weather widget (`weather_update`), gracefully hidden if not configured.
   - Live telemetry: CPU/GPU/RAM/VRAM/storage/network, as gauges or simple
     bars — update in place on every `telemetry_update`.

2. **Devices**
   - Table/card grid driven entirely by `/devices` + live `device_connected`
     / `device_disconnected` events. Must be generic over `deviceType` (see
     §4 requirement) — render capability badges from `device.capabilities`
     rather than hardcoding fields per type.
   - Click into a device → detail view showing full `Device` object:
     firmware/hardware info, network info, current activity, stats, and the
     `eventHistory`/`errorHistory` lists (most recent first).

3. **Companion Chat (browser-as-device)**
   - On page load, open the WebSocket, send `register` with a persisted
     browser device id (generate a UUID once, store in `localStorage`,
     reuse it — this is what lets the browser show up in `/devices` too, as
     `deviceType: "unknown"` or you can propose a new type like
     `"web_client"` if you want it visually distinct — ask before assuming a
     new deviceType is "supported" server-side beyond being a string).
   - **Text mode:** input box → send `ai_prompt` → stream `ai_token`s into a
     chat bubble live, show `ai_thinking` collapsed/separate if present.
   - **Voice mode:** record from the browser mic (`MediaRecorder` /
     `getUserMedia`), encode as WAV or send raw and let the backend's
     `format` field describe it, base64-encode, send as `voice_audio`. Play
     back `voice_stream` chunks through the Web Audio API in `sequence`
     order as they arrive (don't wait for `voice_stream_end` to start
     playing — start as soon as chunk 0 arrives, queue the rest).
   - Show live activity state (idle / listening / thinking / speaking)
     driven by device `currentActivity` for your own registered id, or just
     track it locally around your own request lifecycle.

4. **Settings (optional but nice)**
   - Per-device settings editor hitting `GET`/`POST /api/companion/settings`.
   - OTA info display (`GET /api/companion/ota`) — read-only status, not an
     upload UI (firmware flashing itself is out of scope here).

---

## 11. Notification types to plan UI for

These are the categories the backend may push via the `notification` event
(exact trigger wiring may not all exist yet — build the UI generically
around `{ title, body?, level? }` rather than hardcoding a switch per type):

AI Finished, Image Generation Complete, Model Download Complete, GPU
Temperature Warning, New Email, Git Commit, Build Complete, Weather Alert,
Server Offline.

A simple toast/notification-center pattern that just renders whatever
`title`/body fields are present is enough — don't assume a fixed enum of
`type` values beyond what's shown above, more may be added later without
frontend changes if you keep this generic.

---

## 12. Reliability expectations (mirror what the backend already does)

- **Auto-reconnect the WebSocket** on close/error with backoff (e.g. 1s,
  2s, 5s, capped) — this is required, the backend already expects
  reconnects and has offline-sweep logic that assumes clients come back.
- **Re-send `register`** immediately after every successful reconnect —
  the backend has no persistent session, a fresh connection is a fresh
  registration.
- Treat `/health` as your "is the backend even up" probe before doing
  anything WS-related, useful for an initial connection-status banner.
- Don't poll REST endpoints that have WS equivalents (`status`, `telemetry`,
  `weather`) faster than roughly once every 10–15s if you do poll as a
  fallback — prefer the WS push events, they already arrive on sane
  intervals.

---

## 13. Explicitly out of scope for this frontend task

- No camera/QR UI yet — those backend endpoints don't exist yet, don't
  build for them.
- No OTA upload/flashing UI — read-only OTA info display only.
- No auth UI — the API is currently unauthenticated on the local network.
  Don't build a login screen; if/when API keys are added, that'll be a
  separate follow-up spec.
- No voice/provider selection UI (see §9).
- No framework, no build tooling, no bundler — plain HTML/CSS/JS,
  browser-native `fetch`/`WebSocket`/`MediaRecorder`/Web Audio APIs only.

---

## 14. Deliverable

`app/frontend/` containing at minimum:
- `index.html`
- CSS (one file or a small few, your call)
- `js/` with clearly separated concerns, e.g.:
  - `companion-client.js` — the WebSocket wrapper (connect/reconnect/register/send/on-event), reusable by every page/section
  - `dashboard.js`, `devices.js`, `chat.js` — page-specific logic consuming the client
  - `config.js` — the single place the Companion API base URL/port lives

Everything should work against the real backend on `COMPANION_PORT` (3005
by default) with zero backend changes required.
