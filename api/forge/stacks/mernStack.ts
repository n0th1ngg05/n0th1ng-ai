// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/mernStack.ts
//
// Composes TWO sibling scaffold branches under one root — a trimmed
// Node/Express backend profile (server/) and a React frontend profile
// (client/) — with the integration-check depending on both branches' final
// tasks. Per the build order, only trusted for real sessions after
// nodeExpress has been proven end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";

export const mernStack: StackProfile = {
    id: "mern-stack",
    packageManager: "npm",
    buildCmd: "cd client && npm run build",
    testCmd: "cd server && npm test",
    // PORT env var into the backend's npm start, matching the Express
    // process.env.PORT convention (see the scaffold step below, which
    // instructs the model to read it the same way). {{PORT}} substituted
    // with the session's real allocated port at prompt-build time — never a
    // hardcoded port that could collide with something else on the host.
    runCmd: "cd server && PORT={{PORT}} npm start",
    devServerPort: 0, // unused — real port is session.allocatedPort now

    // Indices 0-3: backend branch (server/). Indices 4-6: frontend branch
    // (client/), which only depends on the route-contract step (1), not on
    // the whole backend — the two branches proceed as siblings. The final
    // "join the branches" step is now content-only (serve client/dist
    // statically, no server start) — the mandatory integrationCheck, which
    // taskTree.ts enforces runs only after EVERY task here is done, is the
    // ONLY place a real server-start / port-bind is attempted.
    scaffoldSteps: [
        {
            description:
                "Scaffold the backend in server/: package.json (scripts: start/test), " +
                "install express mongoose cors, create server/src/server.js with an " +
                "Express app listening on process.env.PORT (fall back to 3000 only if " +
                "unset, e.g. `const PORT = process.env.PORT || 3000`), a GET /health " +
                "route returning { ok: true }, and a MongoDB connection via mongoose " +
                "(default mongodb://localhost:27017, database named after the " +
                "project; fall back to an in-memory store if MongoDB is unreachable " +
                "so the app still boots).",
            acceptanceCriteria:
                "`cd server && npm install` exits 0 AND server/src/server.js exists.",
            dependsOn: [],
        },
        {
            description:
                "Backend data layer + routes: Mongoose schemas for the goal's models " +
                "in server/src/models/, REST CRUD routes in server/src/routes/ " +
                "mounted under /api. Register a contract listing every route " +
                "(method, path, request/response shape).",
            acceptanceCriteria:
                "`cd server && node -e \"require('./src/server.js')\"` exits 0.",
            dependsOn: [0],
        },
        {
            description:
                "Backend auth if the goal calls for it (signup/login routes, bcryptjs " +
                "hashing, JWT middleware protecting /api). If no auth requirement, " +
                "add a permissive no-op middleware and note it.",
            acceptanceCriteria:
                "`cd server && node -e \"require('./src/server.js')\"` exits 0 with " +
                "auth wired.",
            dependsOn: [1],
        },
        {
            description:
                "Backend tests: node:test or jest tests covering the models and at " +
                "least one route per model, wired to `npm test` in server/. Run " +
                "purely against an in-process test client — do NOT bind a real port " +
                "here; that happens exactly once, later, in the mandatory final " +
                "integration check.",
            acceptanceCriteria:
                "`cd server && npm test` exits 0 with at least one passing test.",
            dependsOn: [2],
        },
        {
            description:
                "Scaffold the frontend in client/ with Vite + React " +
                "(`npm create vite@latest client -- --template react`), install " +
                "dependencies, configure the dev server proxy so /api hits the " +
                "backend (proxy target uses the same PORT the backend reads from " +
                "process.env.PORT, not a hardcoded port).",
            acceptanceCriteria: "`cd client && npm install && npm run build` exits 0.",
            dependsOn: [1],
        },
        {
            description:
                "Frontend components for each core workflow of the goal (list, " +
                "create, edit, delete as applicable), fetching /api per the " +
                "registered route contract.",
            acceptanceCriteria: "`cd client && npm run build` exits 0.",
            dependsOn: [4],
        },
        {
            description:
                "Frontend polish: routing (react-router-dom) if the goal implies " +
                "multiple views, loading/error states on every fetch, and styles.",
            acceptanceCriteria: "`cd client && npm run build` exits 0.",
            dependsOn: [5],
        },
        {
            description:
                "Join the branches: wire Express to serve client/dist statically as " +
                "the final fallback route, so GET / (and any non-/api path) returns " +
                "the built frontend once the server is running. Content/config only " +
                "— do NOT start the server or bind any port in this task; the only " +
                "server-start happens in the mandatory final integration check.",
            acceptanceCriteria:
                "server/src/server.js contains a static-file middleware pointing at " +
                "client/dist AND `cd client && npm run build` exits 0.",
            dependsOn: [3, 6],
        },
    ],

    // The ONLY task in this profile that starts a real server / binds a real
    // port. Runs after every file in both branches has been written and
    // joined (enforced by taskTree.pickNextTask). If this fails,
    // agentLoop.ts writes a SETUP.md into the workspace explaining what to
    // try manually.
    integrationCheck: {
        description:
            "Final whole-app smoke test: build the client, start the server with " +
            "`cd server && npm start` in the background on the session's assigned " +
            "port, curl /health and /, assert both return HTTP 200, then stop the " +
            "server.",
        acceptanceCriteria:
            "curl to /health AND to / both return HTTP status 200 while the server " +
            "is running.",
    },
};