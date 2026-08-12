// api/routers/personaplex.ts
//
// PersonaPlex (nvidia/personaplex-7b-v1) is a full-duplex speech-to-speech
// model built on the Moshi architecture — NOT an Ollama-compatible GGUF
// model, so it can't be `ollama pull`ed. It needs its own Python venv,
// PyTorch/CUDA, and NVIDIA's moshi package, run as a long-lived subprocess
// exactly like the Python/Speech runtimes already are.
//
// This file is intentionally self-contained (setup + process lifecycle +
// persona/voice config all in one place) rather than split into a
// separate manager class, since — unlike Python/Speech — there's no
// existing manager to delegate to yet.
//
// Real VRAM note, not a blocker but worth knowing while testing: the
// original checkpoint needs ~14GB VRAM (bf16); users report streaming
// inference spiking towards the high-teens of GB even on larger cards.
// A 4-bit NF4 quant cuts resting usage roughly in half. --cpu-offload
// (below) trades VRAM for latency/audio choppiness rather than solving
// the ceiling. None of that blocks running this — it's just why the
// setup step below defaults to --cpu-offload off and lets you flip it.

import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";

// ── Config ──────────────────────────────────────────────────────────────

const PERSONAPLEX_PORT = 8998;
const INSTALL_DIR = path.join(process.cwd(), "personaplex-runtime");
const VENV_PYTHON =
  process.platform === "win32"
    ? path.join(INSTALL_DIR, "venv", "Scripts", "python.exe")
    : path.join(INSTALL_DIR, "venv", "bin", "python");
const REPO_URL = "https://github.com/NVIDIA/personaplex.git";

// The 18 pre-packaged voice embeddings PersonaPlex ships with — these are
// fixed filenames in the model's assets/voices/ dir (NATxN.pt / VARxN.pt),
// not something we invent or configure. Confirmed against NVIDIA's own
// README and the model card. Frontend should render these as a dropdown,
// not a free-text field, since anything else won't resolve to a real file.
export const PERSONAPLEX_VOICES = [
  { id: "NATF0", label: "Natural Female 1" },
  { id: "NATF1", label: "Natural Female 2" },
  { id: "NATF2", label: "Natural Female 3" },
  { id: "NATF3", label: "Natural Female 4" },
  { id: "NATM0", label: "Natural Male 1" },
  { id: "NATM1", label: "Natural Male 2" },
  { id: "NATM2", label: "Natural Male 3" },
  { id: "NATM3", label: "Natural Male 4" },
  { id: "VARF0", label: "Variety Female 1" },
  { id: "VARF1", label: "Variety Female 2" },
  { id: "VARF2", label: "Variety Female 3" },
  { id: "VARF3", label: "Variety Female 4" },
  { id: "VARF4", label: "Variety Female 5" },
  { id: "VARM0", label: "Variety Male 1" },
  { id: "VARM1", label: "Variety Male 2" },
  { id: "VARM2", label: "Variety Male 3" },
  { id: "VARM3", label: "Variety Male 4" },
  { id: "VARM4", label: "Variety Male 5" },
] as const;

export type Persona = {
  id: string;
  name: string;
  voiceId: (typeof PERSONAPLEX_VOICES)[number]["id"];
  // Free-text role/character prompt — this is PersonaPlex's actual
  // "text prompt" input, capped at ~200 tokens per NVIDIA's own docs.
  // We don't hard-enforce the token count here (that requires the same
  // tokenizer PersonaPlex uses internally) — just a generous char cap as
  // a sane guard, with the real limit enforced model-side.
  systemPrompt: string;
  createdAt: number;
};

// In-memory persona store. Intentionally not DB-backed: these are a
// handful of small text+voice-id records a single user edits from one
// settings page — a JSON file is enough persistence without a schema
// migration, and this router owns its own file I/O below.
const PERSONA_STORE_PATH = path.join(INSTALL_DIR, "personas.json");

function loadPersonas(): Persona[] {
  try {
    if (!fs.existsSync(PERSONA_STORE_PATH)) return [];
    return JSON.parse(fs.readFileSync(PERSONA_STORE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function savePersonas(personas: Persona[]) {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.writeFileSync(PERSONA_STORE_PATH, JSON.stringify(personas, null, 2));
}

// ── Process lifecycle ───────────────────────────────────────────────────

type SetupState = "not_started" | "cloning" | "installing" | "ready" | "error";

// Windows venvs put installed packages under Lib\site-packages; the
// posix layout is lib/python3.X/site-packages, but since this whole repo
// targets Windows (per VENV_PYTHON's win32 branch above), only that
// layout is checked here — same assumption the rest of this file makes.
const MOSHI_INSTALLED_MARKER = path.join(
  INSTALL_DIR,
  "venv",
  "Lib",
  "site-packages",
  "moshi"
);

// Checking only for venv/Scripts/python.exe is NOT sufficient to prove
// setup finished — that file is created within seconds of `python -m venv`,
// long before the multi-minute `pip install torch` / `pip install -e moshi/`
// steps that follow it. A crash or interrupted setup between those points
// (e.g. the whole Node process dying from an unrelated EADDRINUSE on a
// different port, which has happened) leaves the venv present but moshi
// never actually installed — and the old check would then report "ready"
// on the next boot, causing server.start to spawn a python process that
// immediately fails with "No module named moshi", or in an even more
// confusing case, a spawn that fails silently enough to leave no log at
// all if the failure happens before startServer()'s own guards run.
let setupState: SetupState = fs.existsSync(MOSHI_INSTALLED_MARKER) ? "ready" : "not_started";
let setupLog: string[] = [];
let setupProcess: ChildProcess | null = null;

let serverProcess: ChildProcess | null = null;
let serverStatus: "stopped" | "starting" | "running" | "error" = "stopped";
let serverLog: string[] = [];
let serverError: string | null = null;

function pushLog(buf: string[], line: string) {
  buf.push(`[${new Date().toISOString()}] ${line}`);
  if (buf.length > 500) buf.splice(0, buf.length - 500);
}

function runStep(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    setupProcess = child;

    child.stdout?.on("data", (d) => pushLog(setupLog, d.toString().trim()));
    child.stderr?.on("data", (d) => pushLog(setupLog, d.toString().trim()));

    child.on("exit", (code) => {
      setupProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });

    child.on("error", (err) => {
      setupProcess = null;
      reject(err);
    });
  });
}

/** Clones the repo, creates a venv, and installs the moshi package +
 * dependencies. Does NOT download the ~15GB model weights — those are
 * pulled automatically by moshi.server itself on first launch, per
 * NVIDIA's own docs, so `start()` below is where that download actually
 * happens (surfaced through the same serverLog the UI already polls). */
async function runSetup() {
  if (setupState === "cloning" || setupState === "installing") return;

  setupState = "cloning";
  setupLog = [];
  pushLog(setupLog, "Starting PersonaPlex setup…");

  try {
    if (!fs.existsSync(INSTALL_DIR)) {
      pushLog(setupLog, `Cloning ${REPO_URL}`);
      await runStep("git", ["clone", REPO_URL, INSTALL_DIR], process.cwd());
    } else {
      pushLog(setupLog, "Repo directory already exists, skipping clone.");
    }

    setupState = "installing";

    const venvDir = path.join(INSTALL_DIR, "venv");
    if (!fs.existsSync(venvDir)) {
      pushLog(setupLog, "Creating virtual environment…");
      await runStep("python", ["-m", "venv", "venv"], INSTALL_DIR);
    }

    pushLog(setupLog, "Upgrading pip…");
    await runStep(VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip"], INSTALL_DIR);

    // accelerate is required for --cpu-offload; installed unconditionally
    // so the toggle works without a second setup pass.
    pushLog(setupLog, "Installing moshi + dependencies (this takes a while)…");
    await runStep(
      VENV_PYTHON,
      ["-m", "pip", "install", "torch", "numpy", "sentencepiece", "sphn", "safetensors", "accelerate"],
      INSTALL_DIR
    );
    await runStep(
      VENV_PYTHON,
      ["-m", "pip", "install", "-e", "moshi/"],
      INSTALL_DIR
    );

    // pip can exit 0 on a partial/misleading install in edge cases (e.g.
    // network drop mid-download that pip itself doesn't treat as fatal) —
    // verify the package is actually importable before trusting the exit
    // code, rather than repeating the exact "reported ready, wasn't
    // actually ready" bug this whole check exists to fix.
    if (!fs.existsSync(MOSHI_INSTALLED_MARKER)) {
      throw new Error(
        "pip install reported success, but moshi wasn't found in site-packages afterward. " +
        "This usually means a network interruption during install — try Retry Setup."
      );
    }

    setupState = "ready";
    pushLog(setupLog, "Setup complete. Model weights (~15GB) will download on first Start.");
  } catch (err) {
    setupState = "error";
    pushLog(setupLog, `Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

/** Starts `python -m moshi.server`. First run also triggers the model
 * download (NVIDIA's script handles this itself, not something we
 * script) — that download's progress shows up in serverLog same as any
 * other startup line, since it's just stdout from the same process. */
function startServer(cpuOffload: boolean, hfToken?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (serverProcess) {
      resolve();
      return;
    }
    if (setupState !== "ready") {
      reject(new Error("PersonaPlex isn't set up yet — run setup first."));
      return;
    }

    serverStatus = "starting";
    serverError = null;
    serverLog = [];

    const args = ["-m", "moshi.server", "--ssl", INSTALL_DIR];
    if (cpuOffload) args.push("--cpu-offload");

    const child = spawn(VENV_PYTHON, args, {
      cwd: INSTALL_DIR,
      env: { ...process.env, ...(hfToken ? { HF_TOKEN: hfToken } : {}) },
    });
    serverProcess = child;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      pushLog(serverLog, text.trim());
      // The server prints this exact line once the WebUI is actually
      // reachable — that's the real "running" signal, not just "the
      // process started" (which happens well before weights finish
      // loading onto the GPU).
      if (/Access the Web UI/i.test(text)) {
        serverStatus = "running";
        resolve();
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", (code) => {
      serverProcess = null;
      if (serverStatus !== "running") {
        serverStatus = "error";
        serverError = `Process exited (code ${code}) before startup completed. Check the log — this is almost always a CUDA OOM or missing HF_TOKEN.`;
        reject(new Error(serverError));
      } else {
        serverStatus = "stopped";
      }
    });

    child.on("error", (err) => {
      serverProcess = null;
      serverStatus = "error";
      serverError = err.message;
      reject(err);
    });

    // Don't hang forever if startup stalls (e.g. waiting on a huge
    // download with no progress line matching the regex above).
    setTimeout(() => {
      if (serverStatus === "starting") resolve();
    }, 10000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverStatus = "stopped";
}

// ── Router ──────────────────────────────────────────────────────────────

export const personaplexRouter = createRouter({
  // Static voice list — no I/O, just the fixed catalog above.
  voices: publicQuery.query(() => PERSONAPLEX_VOICES),

  personas: createRouter({
    list: publicQuery.query(() => loadPersonas()),

    create: publicQuery
      .input(
        z.object({
          name: z.string().min(1).max(80),
          voiceId: z.enum(
            PERSONAPLEX_VOICES.map((v) => v.id) as [string, ...string[]]
          ),
          systemPrompt: z.string().min(1).max(1000),
        })
      )
      .mutation(({ input }) => {
        const personas = loadPersonas();
        const persona: Persona = {
          id: `persona_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: input.name,
          voiceId: input.voiceId as Persona["voiceId"],
          systemPrompt: input.systemPrompt,
          createdAt: Date.now(),
        };
        personas.push(persona);
        savePersonas(personas);
        return persona;
      }),

    delete: publicQuery
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const personas = loadPersonas().filter((p) => p.id !== input.id);
        savePersonas(personas);
        return { success: true };
      }),
  }),

  setup: createRouter({
    status: publicQuery.query(() => ({
      state: setupState,
      log: setupLog,
      installed: setupState === "ready",
    })),

    // Fire-and-forget: kicks off cloning + pip install in the background
    // and returns immediately. The frontend polls setup.status for
    // progress rather than holding this request open for the several
    // minutes this can take.
    start: publicQuery.mutation(() => {
      if (setupState === "cloning" || setupState === "installing") {
        return { started: false, reason: "Setup already in progress." };
      }
      runSetup().catch(() => {
        /* error already captured in setupState/setupLog */
      });
      return { started: true };
    }),
  }),

  server: createRouter({
    status: publicQuery.query(() => ({
      status: serverStatus,
      log: serverLog.slice(-100),
      error: serverError,
      port: PERSONAPLEX_PORT,
      url: serverStatus === "running" ? `https://localhost:${PERSONAPLEX_PORT}` : null,
    })),

    start: publicQuery
      .input(
        z.object({
          cpuOffload: z.boolean().default(false),
          hfToken: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await startServer(input.cpuOffload, input.hfToken);
        return { status: serverStatus, error: serverError };
      }),

    stop: publicQuery.mutation(() => {
      stopServer();
      return { status: serverStatus };
    }),
  }),
});