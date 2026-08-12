import { HttpClient } from "./httpClient.js";

// NOTE: selectWorker is NOT imported at module top level.
//
// clusterHttpClient.ts is imported by pythonRuntime.ts, which is pulled in
// by runtimeFactory.ts → runtimeManager.ts → speechManager.ts → every speech
// API router, which router.ts imports. A static import of cluster.ts here
// would drag cluster.ts → python-runtime/client.ts → runtime/manager.ts into
// Vite's synchronous module-graph walk, causing a "transport invoke timed out
// after 60000ms" error.
//
// Instead, we lazily resolve selectWorker the first time request() is called.
// By that point start() in pythonRuntime.ts has already awaited getSelectWorker(),
// so cluster.ts is loaded and the dynamic import resolves from cache instantly.
let _selectWorkerCache: ((tool: string) => import("../../services/cluster.js").Worker | undefined) | undefined;

async function getSelectWorker() {
    if (!_selectWorkerCache) {
        const { selectWorker } = await import("../../services/cluster.js");
        _selectWorkerCache = selectWorker;
    }
    return _selectWorkerCache;
}


const REQUEST_TIMEOUT = 300000;

export class ClusterHttpClient extends HttpClient {

    // Used to fall back to the local runtime if the worker selected at the
    // start of a request becomes unreachable (or offline) mid-flight. This
    // mirrors the fallback behavior already used elsewhere in the cluster
    // code (see services/clusterSpeech.ts) — previously this client just
    // threw, which meant a worker dropping mid-session broke TTS/STT
    // entirely instead of degrading to the local runtime.
    private localFallback: HttpClient;

    constructor(localBaseUrl: string) {

        // Dummy base URL.
        // The ClusterHttpClient never uses HttpClient's base URL directly.
        super("http://cluster-runtime");

        this.localFallback = new HttpClient(localBaseUrl);

    }

    override async request<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {

        const selectWorker = await getSelectWorker();
        const worker = selectWorker("speech");

        if (!worker) {

            return this.callLocalFallback<T>(method, path, body);

        }


        const controller = new AbortController();

        const timeout = setTimeout(() => {

            controller.abort();

        }, REQUEST_TIMEOUT);

        try {

            console.log("");
            console.log("========================================");
            console.log("[CLUSTER SPEECH]");
            console.log("Worker :", worker.hostname);
            console.log("Method :", method);
            console.log("Target :", path);
            console.log("========================================");
            console.log("");

            const response = await fetch(

                `http://${worker.ip}:${worker.port}/speech`,

                {

                    method: "POST",

                    headers: {

                        "Content-Type": "application/json",

                    },

                    body: JSON.stringify({

                        url: path,

                        method,

                        body,

                    }),

                    signal: controller.signal,

                }

            );

            clearTimeout(timeout);

            if (!response.ok) {

                throw new Error(

                    `Worker returned ${response.status}`

                );

            }

            return await response.json();

        } catch (err: any) {

            clearTimeout(timeout);

            console.warn(
                `[CLUSTER SPEECH] Worker unreachable (${err?.message ?? err}), falling back to local runtime.`
            );

            return this.callLocalFallback<T>(method, path, body);

        }

    }

    private callLocalFallback<T>(
        method: string,
        path: string,
        body?: unknown
    ): Promise<T> {

        const m = method.toUpperCase();

        if (m === "GET") return this.localFallback.get<T>(path);
        if (m === "DELETE") return this.localFallback.delete<T>(path);
        return this.localFallback.post<T>(path, body);

    }

    override async get<T>(
        path: string
    ): Promise<T> {

        return this.request<T>(

            "GET",

            path

        );

    }

    override async post<T>(
        path: string,
        body: unknown
    ): Promise<T> {

        return this.request<T>(

            "POST",

            path,

            body

        );

    }

}