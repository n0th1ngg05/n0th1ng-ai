import { pythonRuntimeClient } from "./client";

export class PythonRuntimeManager {

    private online = false;

    async initialize() {

        try {

            await pythonRuntimeClient.health();

            this.online = true;

            console.log("[Python Runtime] Connected");

        } catch {

            this.online = false;

            console.log("[Python Runtime] Offline");

        }

    }

    isOnline() {

        return this.online;

    }

}

export const pythonRuntimeManager =
    new PythonRuntimeManager();