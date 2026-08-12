import { execSync } from "child_process";

/**
 * Forcibly frees a TCP port before we try to bind/spawn something on it.
 *
 * Why this exists: graceful shutdown handlers (SIGINT/SIGTERM in
 * manager.ts) only run on a clean exit. A crash, `taskkill /F`, VS Code
 * force-closing its integrated terminal, or a power cut all skip those
 * handlers entirely and can leave a previous python.exe/uvicorn process
 * still bound to 8002 or 9000. Rather than rely solely on cleanup after
 * the fact, this runs BEFORE every spawn attempt and kills whatever is
 * currently listening on the target port, so a stale process from last
 * time can never block this run.
 *
 * Platform notes:
 * - Windows: `netstat -ano` + `taskkill /F /PID <pid>`
 * - macOS/Linux: `lsof -ti tcp:<port>` + `kill -9 <pid>`
 *
 * Failures here are swallowed on purpose — if the port turns out to
 * already be free, these commands naturally find nothing and "fail",
 * which is not an error condition.
 */
export function freePort(port: number): void {
    const isWindows = process.platform === "win32";

    try {
        if (isWindows) {
            // netstat output line example:
            //   TCP    127.0.0.1:8002    0.0.0.0:0    LISTENING    12345
            const output = execSync(
                `netstat -ano -p tcp | findstr :${port}`,
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
            );

            const pids = new Set<string>();
            for (const line of output.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.includes("LISTENING")) continue;

                const parts = trimmed.split(/\s+/);
                const pid = parts[parts.length - 1];
                // Guard against killing PID 0 (System Idle) or garbage matches
                if (pid && /^\d+$/.test(pid) && pid !== "0") {
                    pids.add(pid);
                }
            }

            for (const pid of pids) {
                try {
                    execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
                    console.log(`[Runtime] Freed port ${port} (killed PID ${pid})`);
                } catch {
                    // Process may have already exited between the scan and the kill — fine.
                }
            }
        } else {
            const output = execSync(`lsof -ti tcp:${port}`, {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            });

            const pids = output.split("\n").map(l => l.trim()).filter(Boolean);

            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: "ignore" });
                    console.log(`[Runtime] Freed port ${port} (killed PID ${pid})`);
                } catch {
                    // Already gone — fine.
                }
            }
        }
    } catch {
        // No process found on the port (the common case) — nothing to do.
        // Both netstat/findstr and lsof exit non-zero when there's no match,
        // which execSync throws on, so this catch is the expected path
        // whenever the port was already free.
    }
}