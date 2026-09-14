// src/runtime/logBuffer.ts
//
// Captures stdout/stderr from spawned runtime processes (Python runtime,
// Speech runtime — which includes Kokoro among its 7 providers) into a
// bounded in-memory ring buffer per source, and lets callers subscribe to
// new lines as they arrive. This is the thing that makes worker-side logs
// visible to the master/browser at all — previously process.ts used
// `stdio: "inherit"`, which piped everything straight to this worker's own
// terminal and nowhere else.

export interface LogLine {
    source: "python" | "speech";
    stream: "stdout" | "stderr";
    line: string;
    timestamp: number;
}

const MAX_LINES_PER_SOURCE = 500;

class LogBuffer {
    private buffers = new Map<LogLine["source"], LogLine[]>();
    private listeners = new Set<(entry: LogLine) => void>();

    push(entry: LogLine) {
        const buf = this.buffers.get(entry.source) ?? [];
        buf.push(entry);
        if (buf.length > MAX_LINES_PER_SOURCE) {
            buf.splice(0, buf.length - MAX_LINES_PER_SOURCE);
        }
        this.buffers.set(entry.source, buf);

        for (const listener of this.listeners) {
            try {
                listener(entry);
            } catch {
                // A broken listener must never take down log capture itself.
            }
        }
    }

    /** Returns a snapshot of buffered lines, optionally filtered to one source. */
    getRecent(source?: LogLine["source"]): LogLine[] {
        if (source) return [...(this.buffers.get(source) ?? [])];
        return [...(this.buffers.get("python") ?? []), ...(this.buffers.get("speech") ?? [])]
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /** Subscribes to every new line as it arrives. Returns an unsubscribe fn. */
    subscribe(listener: (entry: LogLine) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** The Speech Runtime is a single process serving all 7 TTS/STT
     * providers (kokoro, whisper, xtts, fishspeech, dia, chatterbox,
     * piper) — there's no separate Kokoro process to isolate. This
     * filters the "speech" source down to lines that actually mention
     * Kokoro, so a "Kokoro logs" pane isn't drowned out by the other six
     * engines' output. Matching is intentionally loose (case-insensitive
     * substring) since the Python side's log format isn't guaranteed to
     * prefix every line consistently. */
    getKokoroLines(): LogLine[] {
        return (this.buffers.get("speech") ?? []).filter((entry) =>
            /kokoro/i.test(entry.line)
        );
    }
}

export const logBuffer = new LogBuffer();

/** Splits a raw chunk from a child process stream into individual lines,
 * dropping the trailing empty segment a well-formed chunk normally ends
 * with (chunks don't always align to line boundaries, but this is a
 * console log stream, not something requiring exact reassembly — an
 * occasional split mid-line is an acceptable trade-off for simplicity
 * here, same as how the existing console output already reads). */
export function splitLines(chunk: Buffer | string): string[] {
    return chunk
        .toString("utf-8")
        .split(/\r?\n/)
        .filter((line) => line.length > 0);
}