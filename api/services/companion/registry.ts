// api/services/companion/registry.ts
//
// Runtime Device Registry for the n0th1ng Companion API.
//
// This is the in-memory, live source of truth for every piece of connected
// hardware (ESP32 Companion, ESP32-CAM, future LoRa/BLE/sensor nodes, etc).
// It intentionally mirrors the shape and conventions already established by
// services/cluster.ts (Worker registry) so the two systems feel consistent:
// register() / heartbeat() / removeOffline() / getAll() / getOne().
//
// This module has NO knowledge of HTTP or WebSocket — it is pure state +
// bookkeeping. services/companion.ts is the only thing that talks to it.

export type DeviceType =
    | "esp32_companion"
    | "esp32_cam"
    | "lora_node"
    | "ble_node"
    | "sensor_node"
    | "automation_controller"
    | "unknown";

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface DeviceEvent {
    ts: number;
    type: string;
    detail?: any;
}

export interface RuntimeDevice {
    // Identity
    id: string; // MAC address or other stable hardware id
    deviceType: DeviceType;
    friendlyName: string;

    // Status
    registered: boolean;
    online: boolean;
    connectionState: ConnectionState;

    // Firmware / hardware
    firmwareVersion?: string;
    hardwareRevision?: string;

    // Network
    ip?: string;
    rssi?: number;

    // Capabilities this device advertised at registration time
    // (e.g. ["telemetry", "voice", "camera", "qr", "notifications"])
    capabilities: string[];

    // Liveness
    registeredAt: number;
    lastHeartbeat: number;
    bootTimestamp?: number;

    // Activity
    currentActivity: string | null;
    currentRequests: number;
    activeSessions: string[];

    // Stats
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

    // History (bounded ring buffers so this never grows unbounded)
    eventHistory: DeviceEvent[];
    errorHistory: DeviceEvent[];

    // Arbitrary per-device config/settings synced from backend
    settings?: Record<string, any>;
}

export interface RegisterInput {
    id: string;
    deviceType?: DeviceType;
    friendlyName?: string;
    firmwareVersion?: string;
    hardwareRevision?: string;
    ip?: string;
    rssi?: number;
    capabilities?: string[];
    bootTimestamp?: number;
}

const MAX_HISTORY = 50;
const HEARTBEAT_TIMEOUT_MS = 30_000;

class DeviceRegistry {
    private devices = new Map<string, RuntimeDevice>();

    /** Registers a device, or refreshes it quietly if already known. */
    register(input: RegisterInput): RuntimeDevice {
        const existing = this.devices.get(input.id);
        const now = Date.now();

        if (existing) {
            existing.friendlyName = input.friendlyName ?? existing.friendlyName;
            existing.firmwareVersion = input.firmwareVersion ?? existing.firmwareVersion;
            existing.hardwareRevision = input.hardwareRevision ?? existing.hardwareRevision;
            existing.ip = input.ip ?? existing.ip;
            existing.rssi = input.rssi ?? existing.rssi;
            existing.capabilities = input.capabilities ?? existing.capabilities;
            existing.registered = true;
            existing.online = true;
            existing.connectionState = "connected";
            existing.lastHeartbeat = now;
            existing.connectionStats.totalConnections++;

            this.pushEvent(existing, "re-registered");

            console.log(`[COMPANION] Device re-registered: ${existing.friendlyName} (${existing.id})`);

            return existing;
        }

        const device: RuntimeDevice = {
            id: input.id,
            deviceType: input.deviceType ?? "unknown",
            friendlyName: input.friendlyName ?? input.id,

            registered: true,
            online: true,
            connectionState: "connected",

            firmwareVersion: input.firmwareVersion,
            hardwareRevision: input.hardwareRevision,

            ip: input.ip,
            rssi: input.rssi,

            capabilities: input.capabilities ?? [],

            registeredAt: now,
            lastHeartbeat: now,
            bootTimestamp: input.bootTimestamp,

            currentActivity: null,
            currentRequests: 0,
            activeSessions: [],

            runtimeStats: {
                uptimeMs: 0,
                messagesReceived: 0,
                messagesSent: 0,
            },
            connectionStats: {
                totalConnections: 1,
                totalDisconnections: 0,
                totalReconnects: 0,
            },

            eventHistory: [],
            errorHistory: [],
        };

        this.devices.set(device.id, device);
        this.pushEvent(device, "registered");

        console.log("\n==================================================");
        console.log("           COMPANION DEVICE REGISTERED");
        console.log("==================================================");
        console.log(`ID       : ${device.id}`);
        console.log(`Name     : ${device.friendlyName}`);
        console.log(`Type     : ${device.deviceType}`);
        console.log(`IP       : ${device.ip ?? "unknown"}`);
        console.log(`Firmware : ${device.firmwareVersion ?? "unknown"}`);
        console.log(`Devices  : ${this.devices.size}`);
        console.log("==================================================\n");

        return device;
    }

    /** Marks a heartbeat/telemetry tick for a device. */
    heartbeat(id: string, patch?: Partial<Pick<RuntimeDevice, "rssi" | "currentActivity" | "ip">>): RuntimeDevice | null {
        const device = this.devices.get(id);
        if (!device) return null;

        device.online = true;
        device.connectionState = "connected";
        device.lastHeartbeat = Date.now();

        if (patch?.rssi !== undefined) device.rssi = patch.rssi;
        if (patch?.ip !== undefined) device.ip = patch.ip;
        if (patch?.currentActivity !== undefined) device.currentActivity = patch.currentActivity;

        return device;
    }

    /** Marks a device as cleanly disconnected (graceful WS close). */
    disconnect(id: string, reason?: string) {
        const device = this.devices.get(id);
        if (!device) return;

        device.online = false;
        device.connectionState = "disconnected";
        device.connectionStats.totalDisconnections++;
        device.connectionStats.lastDisconnectReason = reason;

        this.pushEvent(device, "disconnected", { reason });
    }

    /** Sweeps devices that have missed their heartbeat window. */
    sweepOffline() {
        const now = Date.now();
        for (const device of this.devices.values()) {
            if (device.online && now - device.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
                device.online = false;
                device.connectionState = "disconnected";
                device.connectionStats.totalDisconnections++;
                device.connectionStats.lastDisconnectReason = "heartbeat_timeout";
                this.pushEvent(device, "heartbeat_timeout");
                console.log(`[COMPANION] Device offline (heartbeat timeout): ${device.friendlyName}`);
            }
        }
    }

    recordMessageIn(id: string) {
        const device = this.devices.get(id);
        if (device) device.runtimeStats.messagesReceived++;
    }

    recordMessageOut(id: string) {
        const device = this.devices.get(id);
        if (device) device.runtimeStats.messagesSent++;
    }

    recordError(id: string, message: string, detail?: any) {
        const device = this.devices.get(id);
        if (!device) return;
        device.errorHistory.push({ ts: Date.now(), type: message, detail });
        if (device.errorHistory.length > MAX_HISTORY) device.errorHistory.shift();
    }

    pushEvent(device: RuntimeDevice, type: string, detail?: any) {
        device.eventHistory.push({ ts: Date.now(), type, detail });
        if (device.eventHistory.length > MAX_HISTORY) device.eventHistory.shift();
    }

    setSettings(id: string, settings: Record<string, any>) {
        const device = this.devices.get(id);
        if (!device) return null;
        device.settings = { ...(device.settings ?? {}), ...settings };
        return device;
    }

    getAll(): RuntimeDevice[] {
        return [...this.devices.values()];
    }

    getOne(id: string): RuntimeDevice | undefined {
        return this.devices.get(id);
    }

    remove(id: string) {
        this.devices.delete(id);
    }

    /** Lightweight summary for dashboard/browser consumption. */
    summary() {
        const all = this.getAll();
        return {
            total: all.length,
            online: all.filter((d) => d.online).length,
            offline: all.filter((d) => !d.online).length,
            byType: all.reduce<Record<string, number>>((acc, d) => {
                acc[d.deviceType] = (acc[d.deviceType] ?? 0) + 1;
                return acc;
            }, {}),
        };
    }
}

export const deviceRegistry = new DeviceRegistry();

// Periodic sweep for silently-dropped connections (crashed device, Wi-Fi
// drop without a clean close frame, etc). Mirrors removeOfflineWorkers()'s
// 5s cadence in cluster.ts.
setInterval(() => deviceRegistry.sweepOffline(), 5000);