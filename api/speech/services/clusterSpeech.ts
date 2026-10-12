import { selectWorker } from "../../services/cluster";
import type { SpeechHttpRequest } from "../utils/httpClient";

const REQUEST_TIMEOUT = 300000;

export async function executeClusterSpeech(

    request: SpeechHttpRequest,

    localExecutor: () => Promise<Response>

): Promise<Response> {
    console.log("========== CLUSTER SPEECH ==========");
    console.log(request.url);

    const worker = selectWorker("speech");

    if (!worker) {

        return localExecutor();

    }

    const controller = new AbortController();

    const timeout = setTimeout(() => {

        controller.abort();

    }, REQUEST_TIMEOUT);

    try {

        // Use the Cloudflare tunnel URL + Bearer auth when the worker is
        // exposed over the internet, otherwise fall back to direct LAN ip:port.
        // This mirrors workerClient.ts's workerTarget() logic.
        const baseUrl = (worker.internetUrl ?? `http://${worker.ip}:${worker.port}`).replace(/\/$/, "");
        const authHeaders: Record<string, string> = worker.internetUrl && worker.apiKey
            ? { Authorization: `Bearer ${worker.apiKey}` }
            : {};
        const via = worker.internetUrl ? "internet (Cloudflare)" : "LAN";

        console.log("");
        console.log("========================================");
        console.log("[SPEECH] Remote Runtime");
        console.log("Worker :", worker.hostname);
        console.log("Via    :", via);
        console.log("Method :", request.method ?? "POST");
        console.log("Target :", request.url);
        console.log("URL    :", `${baseUrl}/speech`);
        console.log("========================================");
        console.log("");

        const response = await fetch(

            `${baseUrl}/speech`,

            {

                method: "POST",

                headers: {

                    "Content-Type": "application/json",
                    ...authHeaders,

                },

                body: JSON.stringify(request),

                signal: controller.signal,

            }

        );

        clearTimeout(timeout);

        if (!response.ok) {

            throw new Error(

                `Worker returned ${response.status}`

            );

        }

        return response;

    } catch (err: any) {

        clearTimeout(timeout);

        console.warn("");
        console.warn("========================================");
        console.warn("[SPEECH] Remote Runtime Failed");
        console.warn(err?.message);
        console.warn("[SPEECH] Falling back to local runtime");
        console.warn("========================================");
        console.warn("");

        return localExecutor();

    }

}