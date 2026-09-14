export async function waitForHealth(
    url: string,
    timeout = 300000
) {

    const start = Date.now();

    // Previously this loop polled silently — if the target never became
    // healthy (wrong venv path, engine crashed on startup, port in use by
    // something else, etc.) you'd see nothing at all for up to `timeout`
    // (5 minutes by default) after "[Runtime] Starting Python Runtime...",
    // which looked exactly like a hang. Logging every ~5s makes it obvious
    // this is actively polling and roughly how long it's been waiting, and
    // logs the specific error on the final failed attempt before throwing.
    let lastLogAt = 0;
    let lastError: unknown = null;

    while (true) {

        try {

            const response = await fetch(url);

            if (response.ok) {

                return;

            }

            lastError = new Error(`HTTP ${response.status}`);

        } catch (err) {

            lastError = err;

        }

        const elapsed = Date.now() - start;

        if (elapsed - lastLogAt >= 5000) {

            lastLogAt = elapsed;

            console.log(
                `[Runtime] Still waiting for ${url} (${Math.round(elapsed / 1000)}s elapsed)...`
            );

        }

        if (elapsed > timeout) {

            const reason =
                lastError instanceof Error ? lastError.message : String(lastError);

            throw new Error(
                `Timeout waiting for ${url} after ${Math.round(timeout / 1000)}s: ${reason}`
            );

        }

        await new Promise(resolve =>
            setTimeout(resolve, 1000)
        );

    }

}