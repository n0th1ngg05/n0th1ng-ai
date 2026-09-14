import { ChildProcess, spawn } from "child_process";
import { logBuffer, splitLines, type LogLine } from "./logBuffer";

export interface RuntimeProcess {

    process: ChildProcess;

    name: string;

    onExit?: () => void;

}

export function startProcess(
    name: string,
    executable: string,
    args: string[],
    cwd: string,
    // Which log source this process's output should be tagged and
    // buffered under. Optional so callers that don't care about log
    // capture (none currently, but kept non-breaking) can omit it.
    logSource?: LogLine["source"]
): RuntimeProcess {

    const child = spawn(
        executable,
        args,
        {
            cwd,
            shell: false,
            // Previously "inherit" — output went straight to this worker's
            // own terminal and nowhere else, so there was nothing to
            // forward to the master. "pipe" keeps the exact same output
            // visible (re-echoed below) while also letting us capture it.
            stdio: logSource ? "pipe" : "inherit"
        }
    );

    const runtime: RuntimeProcess = {

        name,

        process: child

    };

    if (logSource) {

        const onStdout = (chunk: Buffer) => {
            process.stdout.write(chunk);
            for (const line of splitLines(chunk)) {
                logBuffer.push({ source: logSource, stream: "stdout", line, timestamp: Date.now() });
            }
        };

        const onStderr = (chunk: Buffer) => {
            process.stderr.write(chunk);
            for (const line of splitLines(chunk)) {
                logBuffer.push({ source: logSource, stream: "stderr", line, timestamp: Date.now() });
            }
        };

        child.stdout?.on("data", onStdout);
        child.stderr?.on("data", onStderr);

    }

    child.on("exit", code => {

        console.log(`[${name}] exited (${code})`);

        if (logSource) {
            logBuffer.push({
                source: logSource,
                stream: "stderr",
                line: `[${name}] exited (code ${code})`,
                timestamp: Date.now(),
            });
        }

        runtime.onExit?.();

    });

    child.on("error", err => {

        console.error(`[${name}]`, err);

        if (logSource) {
            logBuffer.push({
                source: logSource,
                stream: "stderr",
                line: `[${name}] process error: ${err instanceof Error ? err.message : String(err)}`,
                timestamp: Date.now(),
            });
        }

    });

    return runtime;

}

export function stopProcess(
    runtime: RuntimeProcess
) {

    runtime.process.kill();

}

export function isRunning(
    runtime: RuntimeProcess
) {

    return runtime.process.exitCode === null;

}