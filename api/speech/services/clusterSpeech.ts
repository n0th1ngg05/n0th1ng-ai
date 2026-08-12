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

        console.log("");
        console.log("========================================");
        console.log("[SPEECH] Remote Runtime");
        console.log("Worker :", worker.hostname);
        console.log("Method :", request.method ?? "POST");
        console.log("Target :", request.url);
        console.log("========================================");
        console.log("");

        const response = await fetch(

            `http://${worker.ip}:${worker.port}/speech`,

            {

                method: "POST",

                headers: {

                    "Content-Type": "application/json",

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