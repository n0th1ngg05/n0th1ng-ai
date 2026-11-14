import path from "path";

import {
    RuntimeProcess,
    startProcess
} from "./process";

export const PYTHON_PORT = 8002;

export function startPythonRuntime(): RuntimeProcess {

    const root = process.cwd();

    const runtimePath = path.join(
        root,
        "python-runtime"
    );

    const pythonExe = process.platform === "win32"
        ? path.join(runtimePath, ".venv", "Scripts", "python.exe")
        : path.join(runtimePath, ".venv", "bin", "python");

    return startProcess(

        "Python Runtime",

        pythonExe,

        [
            "-m",
            "app.main"
        ],

        runtimePath,

        "python"

    );

}