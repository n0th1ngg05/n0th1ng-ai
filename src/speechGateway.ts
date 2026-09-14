import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";

const PYTHON_RUNTIME = "http://127.0.0.1:9000";

let runtimeProcess: ChildProcess | null = null;
let starting = false;

export interface SpeechHttpRequest {

    url: string;

    method?: "GET" | "POST";

    headers?: Record<string, string>;

    body?: unknown;

}

async function runtimeHealthy() {

    try {

        const response = await fetch(
            `${PYTHON_RUNTIME}/health`
        );

        return response.ok;

    } catch {

        return false;

    }

}

async function ensureRuntime() {

    if (await runtimeHealthy()) {

        return;

    }

    if (starting) {

        while (!(await runtimeHealthy())) {

            await new Promise(r => setTimeout(r, 500));

        }

        return;

    }

    starting = true;

    const python = path.join(
        process.cwd(),
        "speech-runtime",
        ".venv",
        "Scripts",
        "python.exe"
    );

    const script = path.join(
        process.cwd(),
        "speech-runtime",
        "main.py"
    );

    if (!existsSync(python)) {

        throw new Error(`Python not found: ${python}`);

    }

    if (!existsSync(script)) {

        throw new Error(`main.py not found: ${script}`);

    }

    console.log("");
    console.log("========================================");
    console.log("[WORKER]");
    console.log("Starting Speech Runtime...");
    console.log("========================================");
    console.log("");

    runtimeProcess = spawn(

        python,

        [script],

        {

            cwd: path.join(
                process.cwd(),
                "speech-runtime"
            ),

            stdio: "inherit",

        }

    );

    runtimeProcess.on("exit", () => {

        runtimeProcess = null;

    });

    const start = Date.now();

    while (Date.now() - start < 120000) {

        if (await runtimeHealthy()) {

            starting = false;

            console.log("");
            console.log("========================================");
            console.log("[WORKER]");
            console.log("Speech Runtime Ready");
            console.log("========================================");
            console.log("");

            return;

        }

        await new Promise(r => setTimeout(r, 500));

    }

    starting = false;

    throw new Error("Speech runtime failed to start.");

}

export async function forwardSpeech(
    request: SpeechHttpRequest
): Promise<Response> {

    await ensureRuntime();

    const runtimeUrl = new URL(
        request.url,
        PYTHON_RUNTIME
    );

    const targetUrl =
        `${PYTHON_RUNTIME}${runtimeUrl.pathname}${runtimeUrl.search}`;

    console.log("");
    console.log("========================================");
    console.log("[WORKER SPEECH]");
    console.log("Method :", request.method ?? "POST");
    console.log("Target :", targetUrl);
    console.log("========================================");
    console.log("");

    return fetch(

        targetUrl,

        {

            method: request.method ?? "POST",

            headers: {

                "Content-Type": "application/json",

                ...(request.headers ?? {}),

            },

            body:

                request.body !== undefined

                    ? JSON.stringify(request.body)

                    : undefined,

        }

    );

}