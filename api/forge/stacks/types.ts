// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/types.ts
//
// A StackProfile is the planner's skeleton: instead of asking a 24B model to
// architect a project from a blank page (its weakest skill), planning.ts
// hands it these scaffoldSteps as a fill-in-the-blanks shape. The
// integrationCheck template is mandatory and enforced by taskTree.pickNextTask.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskTemplate = {
    description: string;
    // Must be checkable against real command output ("npm test exits 0"),
    // never vibes ("code looks correct") — EVALUATE has to verify it.
    acceptanceCriteria: string;
    // Indices into the scaffoldSteps array, resolved to real task ids when
    // the planner's output is inserted.
    dependsOn: number[];
};

export type StackProfile = {
    id: string;
    scaffoldSteps: TaskTemplate[];
    packageManager: string;
    buildCmd: string;
    testCmd: string;
    runCmd: string;
    devServerPort: number;
    // The single mandatory final task of every session on this stack.
    integrationCheck: Omit<TaskTemplate, "dependsOn">;
};
