import { RuntimeProcess, isRunning } from "./process";

import { startPythonRuntime } from "./python";
import { startSpeechRuntime } from "./speech";
import { waitForHealth } from "./health";

class RuntimeManager {

    private python?: RuntimeProcess;

    private speech?: RuntimeProcess;

    // Guards against start() spawning duplicate Python/speech runtime
    // processes. Previously start() was called fresh on every register()
    // attempt (see server.ts) with no check for "is this already running
    // or already in the middle of starting" — since both runtimes always
    // bind the same fixed ports (8002, 9000; see python.ts/speech.ts), a
    // register() retry loop calling this every few seconds spawned a whole
    // new stack of processes on top of the still-running ones each time,
    // which is what produced the repeated "Starting fishspeech engine...",
    // multiple "Started server process [PID]" lines, and eventually the
    // "paging file is too small" error from too many concurrent torch
    // processes competing for memory.
    private starting = false;

    async start() {

        // Already fully started and both processes are still alive - no
        // need to do anything.
        if (
            this.python && isRunning(this.python) &&
            this.speech && isRunning(this.speech)
        ) {
            return;
        }

        // A start() is already in flight (e.g. a previous register()
        // attempt is still waiting on waitForHealth) - don't kick off a
        // second, overlapping one. Wait for the in-progress one instead.
        if (this.starting) {

            while (this.starting) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            return;

        }

        this.starting = true;

        try {

    console.log("[Runtime] Starting Python Runtime...");

    this.python = startPythonRuntime();

    this.python.onExit = async () => {

        console.log("[Runtime] Restarting Python Runtime...");

        this.python = startPythonRuntime();

        await waitForHealth(
            "http://127.0.0.1:8002/health"
        );

        console.log("[Runtime] Python Runtime Restarted");

    };

    await waitForHealth(
        "http://127.0.0.1:8002/health"
    );

    console.log("[Runtime] Python Runtime Ready");

    console.log("[Runtime] Starting Speech Runtime...");

    this.speech = startSpeechRuntime();

    this.speech.onExit = async () => {

        console.log("[Runtime] Restarting Speech Runtime...");

        this.speech = startSpeechRuntime();

        await waitForHealth(
            "http://127.0.0.1:9000/health"
        );

        console.log("[Runtime] Speech Runtime Restarted");

    };

    await waitForHealth(
        "http://127.0.0.1:9000/health"
    );

    console.log("[Runtime] Speech Runtime Ready");
    console.log("[Runtime] All runtimes online");

        } finally {

            this.starting = false;

        }

}

status() {

    return {

        python: !!this.python,

        speech: !!this.speech

    };


}
}

export const runtimeManager = new RuntimeManager();