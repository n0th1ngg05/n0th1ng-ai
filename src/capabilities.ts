import si from "systeminformation";
import { currentJobs } from "./jobs";
import { ALL_TOOLS } from "./toolRegistry";

// si.currentLoad() and si.networkStats() both do a short (~1s) sampling
// window internally to compute a rate, so calling them on every
// getCapabilities() (register + every heartbeat tick) is intentional here,
// not accidental overhead — there's no cheaper "instant" CPU%/network
// rate available from this library.

export async function getCapabilities() {

    const [graphics, mem, load, temp, network] = await Promise.all([
        si.graphics(),
        si.mem(),
        si.currentLoad(),
        // Not every machine exposes a CPU temp sensor to the OS (common on
        // laptops without vendor tooling installed) — si resolves to
        // { main: null, ... } in that case rather than throwing, so this
        // is safe to always call.
        si.cpuTemperature(),
        // Network stats are per-interface; si.networkStats() with no
        // argument returns the default active interface, which is the
        // right one for "this machine's network activity" here.
        si.networkStats(),
    ]);

    const primaryGpu = graphics.controllers[0];
    const net = network[0];

    return {

        id: "desktop-01",

        hostname: "AI-DESKTOP",

        ip: "192.168.0.108",

        port: 3001,

        online: true,

        tools: ALL_TOOLS,

        cpuUsage: Math.round(load.currentLoad),

        ramUsage: Math.round(mem.used / 1024 / 1024 / 1024),

        // utilizationGpu isn't populated by every driver/vendor
        // combination (most reliable on NVIDIA via nvidia-smi under the
        // hood) — falls back to 0 rather than throwing when absent.
        gpuUsage: Math.round(primaryGpu?.utilizationGpu ?? 0),

        temps: {
            cpu: temp.main ?? null,
            // Same NVIDIA-driver caveat as utilizationGpu above.
            gpu: primaryGpu?.temperatureGpu ?? null,
        },

        network: net ? {
            iface: net.iface,
            // si reports cumulative rx/tx *rates* in bytes/sec here (not
            // totals) when called repeatedly like this, which is exactly
            // what a live "network activity" graph wants to plot.
            rxBytesPerSec: Math.round(net.rx_sec ?? 0),
            txBytesPerSec: Math.round(net.tx_sec ?? 0),
        } : null,

        currentJobs: currentJobs(),

        lastHeartbeat: Date.now(),

        gpu:
            primaryGpu?.model ?? "Unknown",

    };

}