// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/pythonFastapi.ts
//
// Same shape as nodeExpress.ts with FastAPI-appropriate commands. Per the
// build order, only trusted for real sessions after nodeExpress has been
// proven end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";

export const pythonFastapi: StackProfile = {
    id: "python-fastapi",
    packageManager: "pip",
    buildCmd: "python -m compileall app",
    testCmd: "python -m pytest -q",
    // {{PORT}} is substituted with the session's real allocated port at
    // prompt-build time (see prompts/think.ts and prompts/integrationCheck.ts)
    // — NOT a hardcoded port. Prevents collisions with anything else already
    // running on the host (a permanent background service, another Forge
    // session, etc).
    runCmd: "python -m uvicorn app.main:app --port {{PORT}}",
    devServerPort: 0, // unused now that allocation is per-session; kept only for StackProfile shape compatibility

    scaffoldSteps: [
        {
            description:
                "Scaffold the project: requirements.txt listing fastapi, uvicorn, " +
                "pytest, httpx (one per line); app/main.py with a FastAPI instance " +
                "and a GET /health route returning {\"ok\": true}. Do NOT run pip " +
                "install, compileall, or any other command for this task — file " +
                "content only. All verification happens once, at the very end.",
            acceptanceCriteria:
                "requirements.txt exists and lists fastapi, uvicorn, pytest, and " +
                "httpx AND app/main.py exists, imports FastAPI, creates an app " +
                "instance, and defines a GET /health route returning a JSON body " +
                "with an \"ok\" key set to true. Judge this by READING the file " +
                "contents shown in the observation — do not run any command.",
            dependsOn: [],
        },
        {
            description:
                "Build the data layer: Pydantic models for the goal's entities plus " +
                "a persistence layer in app/db.py (in-memory dict store or SQLite " +
                "via sqlite3, whichever the goal implies) with CRUD functions. File " +
                "content only — do not run any command for this task.",
            acceptanceCriteria:
                "app/db.py exists, defines Pydantic model(s) matching the goal's " +
                "entities, and defines create/read/update/delete functions " +
                "operating on them. Judge by reading the file content shown in the " +
                "observation — do not run any command.",
            dependsOn: [0],
        },
        {
            description:
                "Implement REST routers for every model under app/routers/, included " +
                "in app/main.py under /api. Register a contract listing every route " +
                "(method, path, request/response shape). File content only — do not " +
                "run any command for this task.",
            acceptanceCriteria:
                "At least one router file exists under app/routers/ defining REST " +
                "endpoints for the goal's models, AND app/main.py includes/mounts " +
                "that router under /api. Judge by reading the file content shown in " +
                "the observation — do not run any command.",
            dependsOn: [1],
        },
        {
            description:
                "Add authentication if the goal calls for it (signup/login routes, " +
                "passlib bcrypt hashing, JWT via python-jose, dependency protecting " +
                "the model routes). If the goal has no auth requirement, add a no-op " +
                "dependency and note it. File content only — do not run any command.",
            acceptanceCriteria:
                "If the goal implies authentication: signup/login route handlers " +
                "exist, password hashing (passlib/bcrypt) is used, JWT creation/" +
                "verification (python-jose) is present, and a dependency protecting " +
                "routes is defined and applied. If the goal has no auth requirement: " +
                "a no-op dependency exists with a comment noting why. Judge by " +
                "reading file content — do not run any command.",
            dependsOn: [2],
        },
        {
            description:
                "Scaffold the frontend: a static/ directory mounted via " +
                "StaticFiles in app/main.py, with index.html, styles.css, and app.js " +
                "fetching from /api per the registered route contract. File content " +
                "only — do not run any command.",
            acceptanceCriteria:
                "static/index.html, static/styles.css, and static/app.js all exist " +
                "AND app/main.py mounts the static/ directory via StaticFiles. " +
                "Judge by reading file content — do not run any command.",
            dependsOn: [3],
        },
        {
            description:
                "Build the frontend views for each core workflow of the goal (list, " +
                "create, edit, delete as applicable) wired to the API in app.js. " +
                "File content only — do not run any command.",
            acceptanceCriteria:
                "app.js references every /api route from the route contract at " +
                "least once. Judge by reading the file content shown in the " +
                "observation — do not run any command.",
            dependsOn: [4],
        },
        {
            description:
                "Write tests: pytest tests using fastapi.testclient covering the data " +
                "layer and at least one route per model. Write the test FILE only — " +
                "do NOT run pytest, do NOT start a real server, do NOT bind any port " +
                "for this task. Running the test suite happens exactly once, later, " +
                "in the mandatory final integration check.",
            acceptanceCriteria:
                "A test file exists under tests/ that imports fastapi.testclient, " +
                "instantiates a TestClient against the app, and contains at least " +
                "one test function exercising a data-layer function and one " +
                "exercising an API route. Judge by reading the file content shown " +
                "in the observation — do not run pytest or any other command.",
            dependsOn: [5],
        },
        {
            description:
                "Review pass: re-read every source file, remove dead code and unused " +
                "dependencies, ensure README.md documents install, run, and test " +
                "commands. This is the LAST content-writing step — every file must be " +
                "complete and correct after this task. Do NOT run any command here " +
                "(no pip install, no pytest, no server start) — that verification " +
                "happens exactly once, in the mandatory final integration check " +
                "that automatically follows this task.",
            acceptanceCriteria:
                "README.md exists and documents an install command (pip install), a " +
                "run command (uvicorn), and a test command (pytest) in readable " +
                "prose or a code block. Judge by reading the file content shown in " +
                "the observation — do not run any command.",
            dependsOn: [6],
        },
    ],

    // The ONLY task in this ENTIRE profile that executes any command at all —
    // not just the only one that starts a server. Every scaffoldStep above is
    // judged purely on file existence/content, never by running pip install,
    // compileall, pytest, or anything else. This task alone installs
    // dependencies, then attempts the server start, then verifies /health.
    // Runs after every file has been written and reviewed (enforced by
    // taskTree.pickNextTask — this only gets queued once nothing else is
    // actionable). If any step here fails, agentLoop.ts writes a SETUP.md
    // explaining what to try manually and the session still completes as
    // 'done' rather than 'blocked' — see taskTree.markStuckAndContinue.
    integrationCheck: {
        description:
            "Final whole-app verification — the ONLY point in this entire build " +
            "where any command is executed. In order: (1) pip install -r " +
            "requirements.txt, (2) python -m compileall app, (3) python -m pytest " +
            "-q, (4) start the server with uvicorn in the background on the " +
            "assigned port, curl http://localhost:{{PORT}}/health, assert HTTP " +
            "200, then stop the server. If install/compile/tests fail, note " +
            "exactly which step failed and stop — do not attempt to start the " +
            "server if the code doesn't even install or compile.",
        acceptanceCriteria:
            "pip install exits 0 AND compileall exits 0 AND pytest exits 0 AND " +
            "curl to /health returns HTTP status 200 while the server is running. " +
            "Report exactly which of these four steps succeeded or failed.",
    },
};