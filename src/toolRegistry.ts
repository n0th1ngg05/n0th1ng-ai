import { PYTHON_TOOLS } from "./pythonTools";

export const NATIVE_TOOLS = [

    "scientific_calculator",

    "internet_search",

    "url_reader",

    "research_query",

    // Not a "tool" in the toolCall sense — this flags that this worker can
    // handle /speech proxy requests (TTS/STT). The API's selectWorker("speech")
    // filters candidate workers by `worker.tools.includes("speech")`, so this
    // entry must be present or the worker will never be selected and every
    // speech request will silently fall back to the local runtime.
    "speech",

];

export const ALL_TOOLS = [

    ...NATIVE_TOOLS,

    ...Array.from(PYTHON_TOOLS),

];