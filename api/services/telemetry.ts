import si from "systeminformation";
import { exec } from "child_process";
import { promisify } from "util";

import { getDb } from "../queries/connection";
import { systemSnapshots } from "@db/schema";

const execAsync = promisify(exec);

let previousRx = 0;
let previousTx = 0;

// Log once every 15 seconds (every 3rd tick at 5s interval)
let tickCount = 0;
const LOG_EVERY_N_TICKS = 3;

export function startTelemetryCollector() {
  console.log("Telemetry collector started");

  setInterval(async () => {
    tickCount++;
    const shouldLog = tickCount % LOG_EVERY_N_TICKS === 0;

    try {
      const db = getDb();

      const [load, mem, temp, fsSize, networkStats] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.cpuTemperature(),
        si.fsSize(),
        si.networkStats(),
      ]);

      const storageUsage = fsSize.length > 0 ? fsSize[0].use : 0;

      const network =
        networkStats.length > 0
          ? networkStats[0]
          : { rx_bytes: 0, tx_bytes: 0 };

      const rxSpeed = previousRx === 0 ? 0 : (network.rx_bytes - previousRx) / 5;
      const txSpeed = previousTx === 0 ? 0 : (network.tx_bytes - previousTx) / 5;

      previousRx = network.rx_bytes;
      previousTx = network.tx_bytes;

      let gpuUsage = 0;
      let gpuTemp: number | null = null;
      let vramUsage = 0;
      let vramTotal = 0;

      try {
        const { stdout } = await execAsync(
          "nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits"
        );

        const values = stdout.trim().split(",");

        gpuUsage  = Number(values[0]?.trim()) || 0;
        gpuTemp   = Number(values[1]?.trim()) || null;
        vramUsage = Number(values[2]?.trim()) || 0;
        vramTotal = Number(values[3]?.trim()) || 0;
      } catch {
        // nvidia-smi unavailable — GPU fields stay at defaults
      }

      // FIX: wrap insert in its own try/catch so an ETIMEDOUT or transient
      // DB failure skips this tick instead of killing the whole collector.
      // Also coerce null/undefined cpu_temp to 0 to satisfy NOT NULL constraint.
      try {
        await db.insert(systemSnapshots).values({
          cpuUsage:  load.currentLoad,
          cpuTemp:   temp.main ?? 0,        // FIX: null → 0, never inserts NULL
          ramUsage:  (mem.used / mem.total) * 100,
          ramTotal:  mem.total,
          gpuUsage,
          gpuTemp,
          vramUsage,
          vramTotal,
          storageUsage,
          networkRx:      network.rx_bytes,
          networkTx:      network.tx_bytes,
          networkRxSpeed: rxSpeed,
          networkTxSpeed: txSpeed,
        });
      } catch (dbErr: any) {
        // Log DB errors but don't let them crash the interval
        console.warn("[Telemetry] DB insert skipped:", dbErr?.cause?.code ?? dbErr?.message);
      }

      if (shouldLog) {
        console.log(
          `[Telemetry] CPU ${load.currentLoad.toFixed(1)}% | ` +
          `RAM ${((mem.used / mem.total) * 100).toFixed(1)}% | ` +
          `GPU ${gpuUsage}% ${gpuTemp != null ? `${gpuTemp}°C` : ""} | ` +
          `RX ${(rxSpeed / 1024).toFixed(1)} KB/s TX ${(txSpeed / 1024).toFixed(1)} KB/s`
        );
      }

    } catch (err) {
      console.error("[Telemetry] Collection error:", err);
    }
  }, 15000);
}