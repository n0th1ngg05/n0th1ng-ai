import { ChildProcess, spawn } from "child_process";

export interface RuntimeProcess {

    process: ChildProcess;

    name: string;

    onExit?: (code: number | null) => void;

}

export function startProcess(
    name: string,
    executable: string,
    args: string[],
    cwd: string
): RuntimeProcess {

    const child = spawn(
        executable,
        args,
        {
            cwd,
            shell: false,
            stdio: "inherit"
        }
    );

    const runtime: RuntimeProcess = {

        name,

        process: child

    };

    child.on("exit", code => {

        console.log(`[${name}] exited (${code})`);

        runtime.onExit?.(code);

    });

    child.on("error", err => {

        console.error(`[${name}]`, err);

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