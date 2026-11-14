import path from "path";

import {
    RuntimeProcess,
    startProcess
} from "./process";

export const SPEECH_PORT = 9000;

export function startSpeechRuntime(): RuntimeProcess {

    const root = process.cwd();

    const runtimePath = path.join(
        root,
        "speech-runtime"
    );

    const pythonExe = process.platform === "win32"
        ? path.join(runtimePath, ".venv", "Scripts", "python.exe")
        : path.join(runtimePath, ".venv", "bin", "python");

    return startProcess(

        "Speech Runtime",

        pythonExe,

        [
            "main.py"
        ],

        runtimePath,

        "speech"

    );

}