const PYTHON_RUNTIME = "http://127.0.0.1:8002";

import { runtimeManager } from "../runtime/manager";
import type { ExecutionResult } from "../toolExecutor";

export class PythonRuntimeClient {

    private ready = false;

    private async ensureRunning() {

        if (this.ready) {

            return;

        }

        try {

            const health = await fetch(
                `${PYTHON_RUNTIME}/health`
            );

            if (health.ok) {

                this.ready = true;

                return;

            }

        } catch {}

        console.log("[Python Runtime] Starting Local Runtime...");

        await runtimeManager.start();

        while (true) {

            try {

                const health = await fetch(
                    `${PYTHON_RUNTIME}/health`
                );

                if (health.ok) {

                    this.ready = true;

                    console.log("[Python Runtime] Ready");

                    return;

                }

            } catch {}

            await new Promise(r => setTimeout(r, 500));

        }

    }

    async health() {

        await this.ensureRunning();

        const res = await fetch(
            `${PYTHON_RUNTIME}/health`
        );

        return await res.json() as ExecutionResult;

    }

    async info() {

        await this.ensureRunning();

        const res = await fetch(
            `${PYTHON_RUNTIME}/info`
        );

        return await res.json() as ExecutionResult;

    }

    async execute(
        tool: string,
        payload: any
    ): Promise<ExecutionResult> {

        await this.ensureRunning();

        const res = await fetch(

            `${PYTHON_RUNTIME}/execute`,

            {

                method: "POST",

                headers: {

                    "Content-Type": "application/json",

                },

                body: JSON.stringify({

                    tool,

                    arguments: payload,

                }),

            }

        );

        return await res.json() as ExecutionResult;

    }

}

export const pythonRuntimeClient =
    new PythonRuntimeClient();