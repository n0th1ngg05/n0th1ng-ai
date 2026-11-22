// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/general.ts
//
// The "anything else" profile — for when the user names a language/framework
// with no dedicated profile (TypeScript CLI tool, C/C++, Go, Rust, a plain
// script, etc). Unlike the other four profiles, this one does NOT pre-write
// real install/build/test/run commands, because those are fundamentally
// different per language and guessing wrong is worse than asking.
//
// Instead: scaffoldSteps describe universal PHASES (setup, core logic,
// interface, tests, review) in prose, and the planning prompt is given the
// user's free-text customStack description and explicitly instructed to
// fill in the actual language-appropriate commands/tooling itself — this is
// exactly the "derive instead of fill in a fixed skeleton" case flagged
// during design. It reintroduces some of the blank-page-planning risk the
// other profiles were built to avoid, which is an inherent, accepted
// tradeoff of supporting arbitrary stacks — there is no way to give a model
// a concrete skeleton for a language nobody specified in advance.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";

export const general: StackProfile = {
    id: "general",
    // These four are placeholders literally instructing the planner to
    // replace them — see prompts/planning.ts's handling of customStack.
    // They are NOT meant to be run as-is; buildIntegrationCheckPrompt and
    // agentLoop only ever use the values the planner actually decided on,
    // which get baked into each task's own description/acceptanceCriteria
    // text instead of read from these fields for this profile specifically.
    packageManager: "(determined by the chosen language/stack)",
    buildCmd: "(determined by the chosen language/stack)",
    testCmd: "(determined by the chosen language/stack)",
    runCmd: "(determined by the chosen language/stack)",
    devServerPort: 0,

    scaffoldSteps: [
        {
            description:
                "Scaffold the project for the specified language/stack: initialize " +
                "whatever project/package manifest that ecosystem uses (e.g. " +
                "go.mod, Cargo.toml, CMakeLists.txt, a plain requirements file, or " +
                "none at all if the language needs none), and create a minimal " +
                "entry point that runs and produces some trivial verifiable output " +
                "(a version string, a 'ready' message, an exit code 0 — whatever is " +
                "idiomatic and checkable for this language).",
            acceptanceCriteria:
                "The project's own build/compile/run command for this language " +
                "exits 0 against the scaffolded entry point.",
            dependsOn: [],
        },
        {
            description:
                "Build the core data/logic layer: the central types, structs, " +
                "classes, or data structures the goal requires, plus the core " +
                "business logic operating on them — no interface (CLI/API/UI) yet, " +
                "just the logic itself, structured so it can be exercised directly " +
                "(a function call, a unit test, a REPL import — whatever fits this " +
                "language).",
            acceptanceCriteria:
                "The core logic can be exercised directly (imported, called, or " +
                "compiled standalone) without errors.",
            dependsOn: [0],
        },
        {
            description:
                "Build the interface layer appropriate to the goal: a CLI, an API, " +
                "a GUI, a library's public surface — whatever the goal actually " +
                "asks for — wired to the core logic from the previous step.",
            acceptanceCriteria:
                "The interface can be invoked (a CLI command runs, an endpoint " +
                "responds, an exported function is callable) and produces correct " +
                "output for at least one real input.",
            dependsOn: [1],
        },
        {
            description:
                "Write tests using whatever testing approach is idiomatic for this " +
                "language/framework, covering the core logic and at least one path " +
                "through the interface layer.",
            acceptanceCriteria:
                "The language's standard test-runner command exits 0 with at least " +
                "one passing test.",
            dependsOn: [2],
        },
        {
            description:
                "Review pass: re-read every source file, remove dead code, ensure a " +
                "README documents how to install dependencies, build, run, and test " +
                "the project — all using the actual commands for this language, not " +
                "placeholders. This is the LAST content-writing step; every file " +
                "must be complete and correct after this task.",
            acceptanceCriteria:
                "README exists and documents real install/build/run/test commands " +
                "for this specific language AND the test command still exits 0.",
            dependsOn: [3],
        },
    ],

    // Whether this even makes sense to "serve" on a port is language/goal
    // dependent (a CLI tool has nothing to curl). The planner is instructed
    // to write a genuinely appropriate final check into this task's own
    // description when it fills in the plan — for a server-shaped goal, a
    // real port-based check; for a CLI/library-shaped goal, running the
    // actual entry point/tests one more time as the final proof it works.
    integrationCheck: {
        description:
            "Final whole-project verification, appropriate to what was actually " +
            "built: if this produced something that serves requests, start it on " +
            "the session's assigned port and verify it responds; if this produced " +
            "a CLI tool or library, run its entry point (or full test suite) one " +
            "final time end-to-end as proof it genuinely works, not just that it " +
            "compiles.",
        acceptanceCriteria:
            "The final verification command(s) exit 0 / return a successful " +
            "response, proving the built project actually runs correctly.",
    },
};