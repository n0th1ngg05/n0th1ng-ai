// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/nodeExpress.ts
//
// The primary profile — proven end-to-end first before the other stacks are
// trusted. Encodes the 9-step scaffold shape: scaffold → data layer → routes
// → auth → frontend scaffold → components → integration → tests → review.
// Every acceptanceCriteria is something EVALUATE can check against real
// command output, never a judgement call.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";

export const nodeExpress: StackProfile = {
    id: "node-express",
    packageManager: "npm",
    buildCmd: "npm run build --if-present",
    testCmd: "npm test",
    // PORT env var, not a CLI flag — matches Express's standard
    // process.env.PORT convention. {{PORT}} substituted with the session's
    // real allocated port at prompt-build time (see prompts/integrationCheck.ts),
    // never a hardcoded port that could collide with something else already
    // running on the host.
    runCmd: "PORT={{PORT}} npm start",
    devServerPort: 0, // unused — real port is session.allocatedPort now

    scaffoldSteps: [
        {
            description:
                "Scaffold the project: package.json (name, scripts: start/test), " +
                "install express, create src/server.js with an Express app listening " +
                "on process.env.PORT (fall back to 3000 only if that env var is unset, " +
                "e.g. `const PORT = process.env.PORT || 3000`) and a GET /health route " +
                "returning { ok: true }. File content only — do not run any command " +
                "for this task; all execution happens once, at the very end.",
            acceptanceCriteria:
                "package.json exists with a \"start\" script AND src/server.js exists, " +
                "requires express, and defines a GET /health route returning " +
                "{ ok: true }. Judge by reading the file content shown in the " +
                "observation — do not run any command.",
            dependsOn: [],
        },
        {
            description:
                "Build the data layer: define the data models the goal requires " +
                "(in-memory store or SQLite via better-sqlite3, whichever the goal " +
                "implies), exported from src/db.js with create/read/update/delete " +
                "functions per model. File content only — do not run any command.",
            acceptanceCriteria:
                "src/db.js exists and defines create/read/update/delete functions " +
                "for the goal's model(s). Judge by reading the file content shown " +
                "in the observation — do not run any command.",
            dependsOn: [0],
        },
        {
            description:
                "Implement the REST routes for every model from the data layer under " +
                "src/routes/, mounted in src/server.js under /api. Register a " +
                "contract listing every route (method, path, request/response shape). " +
                "File content only — do not run any command.",
            acceptanceCriteria:
                "At least one route file exists under src/routes/ defining REST " +
                "endpoints for the goal's models, AND src/server.js mounts it under " +
                "/api. Judge by reading the file content shown in the observation — " +
                "do not run any command.",
            dependsOn: [1],
        },
        {
            description:
                "Add authentication if the goal calls for it (signup/login routes, " +
                "password hashing with bcryptjs, JWT via jsonwebtoken, auth " +
                "middleware protecting the model routes). If the goal has no auth " +
                "requirement, add a permissive no-op middleware and note it. File " +
                "content only — do not run any command.",
            acceptanceCriteria:
                "If the goal implies authentication: signup/login handlers exist, " +
                "bcryptjs hashing and jsonwebtoken JWT logic are present, and auth " +
                "middleware is defined and applied to protected routes. If no auth " +
                "is required: a no-op middleware exists with a comment noting why. " +
                "Judge by reading file content — do not run any command.",
            dependsOn: [2],
        },
        {
            description:
                "Scaffold the frontend: a public/ directory served statically by " +
                "Express, with index.html, styles.css, and app.js that fetches from " +
                "/api using the registered route contract. File content only — do " +
                "not run any command.",
            acceptanceCriteria:
                "public/index.html, public/styles.css, and public/app.js all exist " +
                "AND src/server.js serves public/ via express.static. Judge by " +
                "reading file content — do not run any command.",
            dependsOn: [3],
        },
        {
            description:
                "Build the frontend components/views for each core workflow of the " +
                "goal (list, create, edit, delete as applicable) wired to the API " +
                "routes in app.js. File content only — do not run any command.",
            acceptanceCriteria:
                "app.js references every /api route from the route contract at " +
                "least once. Judge by reading the file content shown in the " +
                "observation — do not run any command.",
            dependsOn: [4],
        },
        {
            description:
                "Write tests: add test file(s) using node:test or jest covering the " +
                "data layer and at least one route per model, and add a \"test\" " +
                "script to package.json. Write the test FILE only — do NOT run " +
                "npm test, do NOT start a real server, do NOT bind any port for " +
                "this task. Running the test suite happens exactly once, later, in " +
                "the mandatory final integration check.",
            acceptanceCriteria:
                "A test file exists that imports/requires a test framework and " +
                "contains at least one test exercising a data-layer function and " +
                "one exercising an API route, AND package.json's \"test\" script " +
                "references it. Judge by reading the file content shown in the " +
                "observation — do not run npm test or any other command.",
            dependsOn: [5],
        },
        {
            description:
                "Review pass: re-read every source file, remove dead code and unused " +
                "dependencies, ensure the README.md documents setup (npm install), " +
                "run (npm start), and test (npm test) commands. This is the LAST " +
                "content-writing step. Do NOT run any command here — that " +
                "verification happens exactly once, in the mandatory final " +
                "integration check that automatically follows this task.",
            acceptanceCriteria:
                "README.md exists and documents the install, run, and test commands " +
                "in readable prose or a code block. Judge by reading the file " +
                "content shown in the observation — do not run any command.",
            dependsOn: [6],
        },
    ],

    // The ONLY task in this ENTIRE profile that executes any command at all.
    // Every scaffoldStep above is judged purely on file existence/content.
    // Runs after every file has been written and reviewed (enforced by
    // taskTree.pickNextTask). If any step fails, agentLoop.ts writes a
    // SETUP.md and the session still completes as 'done', not 'blocked' —
    // see taskTree.markStuckAndContinue.
    integrationCheck: {
        description:
            "Final whole-app verification — the ONLY point in this entire build " +
            "where any command is executed. In order: (1) npm install, (2) npm " +
            "test, (3) start the server with `npm start` in the background on the " +
            "assigned port, curl /health, assert HTTP 200, then stop the server. " +
            "If install/test fail, note exactly which step failed and stop — do " +
            "not attempt to start the server if dependencies don't even install.",
        acceptanceCriteria:
            "npm install exits 0 AND npm test exits 0 AND curl to /health returns " +
            "HTTP status 200 while the server is running. Report exactly which of " +
            "these steps succeeded or failed.",
    },
};