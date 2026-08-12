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

    const pythonExe = path.join(
        runtimePath,
        ".venv",
        "Scripts",
        "python.exe"
    );

    return startProcess(

        "Python Runtime",

        pythonExe,

        [
            "-m",
            "app.main"
        ],

        runtimePath

    );

}