import { pythonRuntimeManager } from "./services/python-runtime";
export async function getRuntimeStatus() {
    return {
        runtimes: {
            python: pythonRuntimeManager.isOnline(),
            speech: true,
        },
    };
}