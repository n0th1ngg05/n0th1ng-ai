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

    const pythonExe = path.join(
        runtimePath,
        ".venv",
        "Scripts",
        "python.exe"
    );

    return startProcess(

        "Speech Runtime",

        pythonExe,

        [
            "main.py"
        ],

        runtimePath

    );

}