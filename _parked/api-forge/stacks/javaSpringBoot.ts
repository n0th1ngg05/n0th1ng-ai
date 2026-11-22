// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/javaSpringBoot.ts
//
// Same shape as nodeExpress.ts with Spring-appropriate commands. Per the
// build order, only trusted for real sessions after nodeExpress has been
// proven end-to-end.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";

export const javaSpringBoot: StackProfile = {
    id: "java-spring-boot",
    packageManager: "maven",
    buildCmd: "mvn -q -DskipTests package",
    testCmd: "mvn -q test",
    // Spring Boot's standard mechanism for overriding the server port from
    // the CLI without editing application.properties. {{PORT}} substituted
    // with the session's real allocated port at prompt-build time — never a
    // hardcoded port that could collide with something else on the host.
    runCmd: "mvn -q spring-boot:run -Dspring-boot.run.arguments=--server.port={{PORT}}",
    devServerPort: 0, // unused — real port is session.allocatedPort now

    scaffoldSteps: [
        {
            description:
                "Scaffold the project: pom.xml with spring-boot-starter-web and " +
                "spring-boot-starter-test, the standard src/main/java layout, an " +
                "Application class with @SpringBootApplication, and a HealthController " +
                "returning {\"ok\": true} at GET /health.",
            acceptanceCriteria: "`mvn -q -DskipTests package` exits 0.",
            dependsOn: [],
        },
        {
            description:
                "Build the data layer: JPA entities for the goal's models (H2 " +
                "in-memory database via spring-boot-starter-data-jpa) plus Spring " +
                "Data repositories for each entity.",
            acceptanceCriteria: "`mvn -q -DskipTests package` exits 0 with the entities added.",
            dependsOn: [0],
        },
        {
            description:
                "Implement REST controllers for every entity under /api with CRUD " +
                "endpoints. Register a contract listing every route (method, path, " +
                "request/response shape).",
            acceptanceCriteria: "`mvn -q -DskipTests package` exits 0 with the controllers added.",
            dependsOn: [1],
        },
        {
            description:
                "Add authentication if the goal calls for it (spring-boot-starter-" +
                "security, signup/login endpoints, BCrypt password hashing, JWT " +
                "filter protecting /api). If the goal has no auth requirement, " +
                "permit-all and note it.",
            acceptanceCriteria: "`mvn -q -DskipTests package` exits 0 with security wired.",
            dependsOn: [2],
        },
        {
            description:
                "Scaffold the frontend: static resources under src/main/resources/" +
                "static (index.html, styles.css, app.js) fetching from /api per the " +
                "registered route contract.",
            acceptanceCriteria:
                "src/main/resources/static/index.html and app.js exist AND " +
                "`mvn -q -DskipTests package` exits 0.",
            dependsOn: [3],
        },
        {
            description:
                "Build the frontend views for each core workflow of the goal (list, " +
                "create, edit, delete as applicable) wired to the API in app.js.",
            acceptanceCriteria:
                "app.js references every /api route from the route contract at least " +
                "once (verified by reading the file content).",
            dependsOn: [4],
        },
        {
            description:
                "Integration pass: start the app, exercise one full user flow " +
                "end-to-end with curl (POST then GET), then stop it.",
            acceptanceCriteria:
                "The POST returns 2xx AND the subsequent GET returns the created " +
                "record in its response body.",
            dependsOn: [5],
        },
        {
            description:
                "Write tests: @SpringBootTest + MockMvc tests covering the " +
                "repositories and at least one endpoint per controller.",
            acceptanceCriteria: "`mvn -q test` exits 0 with at least one passing test.",
            dependsOn: [6],
        },
        {
            description:
                "Review pass: re-read every source file, remove dead code and unused " +
                "dependencies, ensure README.md documents build, run, and test commands.",
            acceptanceCriteria:
                "README.md exists and contains 'mvn' AND `mvn -q test` still exits 0.",
            dependsOn: [7],
        },
    ],

    integrationCheck: {
        description:
            "Final whole-app smoke test: start the app with `mvn -q spring-boot:run` " +
            "in the background on the session's assigned port, curl /health, assert " +
            "HTTP 200, then stop the app.",
        acceptanceCriteria:
            "curl to /health returns HTTP status 200 while the app is running.",
    },
};