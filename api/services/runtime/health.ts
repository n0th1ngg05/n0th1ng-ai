export async function waitForHealth(
    url: string,
    timeout = 300000,
    signal?: AbortSignal
) {

    const start = Date.now();

    while (true) {

        // If the caller aborted (e.g. the process exited), stop polling
        // immediately instead of waiting for the full timeout.
        if (signal?.aborted) {
            throw new Error(`Health check aborted for ${url}: ${signal.reason ?? "process exited"}`);
        }

        try {

            const response = await fetch(url, { signal });

            if (response.ok) {

                return;

            }

        } catch (err: any) {
            // AbortError means the signal fired mid-fetch — propagate it.
            if (err?.name === "AbortError") {
                throw new Error(`Health check aborted for ${url}: process exited before becoming healthy`);
            }
            // Network errors (ECONNREFUSED etc.) are expected while the
            // process is still starting — swallow and retry.
        }

        if (Date.now() - start > timeout) {

            throw new Error(`Timeout waiting for ${url}`);

        }

        await new Promise(resolve =>
            setTimeout(resolve, 1000)
        );

    }

}