// ─────────────────────────────────────────────────────────────────────────────
// forge/stacks/registry.ts
//
// id -> StackProfile lookup, used at session creation. Throws on an unknown
// id — fail LOUD here, because an unknown stack silently defaulting to the
// wrong scaffold is worse than a startup error.
// ─────────────────────────────────────────────────────────────────────────────

import type { StackProfile } from "./types";
import { nodeExpress } from "./nodeExpress";
import { javaSpringBoot } from "./javaSpringBoot";
import { mernStack } from "./mernStack";
import { pythonFastapi } from "./pythonFastapi";
import { general } from "./general";

const PROFILES: Record<string, StackProfile> = {
    [nodeExpress.id]: nodeExpress,
    [javaSpringBoot.id]: javaSpringBoot,
    [mernStack.id]: mernStack,
    [pythonFastapi.id]: pythonFastapi,
    [general.id]: general,
};

export function getStackProfile(id: string): StackProfile {
    const profile = PROFILES[id];
    if (!profile) {
        throw new Error(
            `[FORGE][STACKS] Unknown stack profile '${id}'. Known: ${Object.keys(PROFILES).join(", ")}`
        );
    }
    return profile;
}

export function listStackProfiles(): StackProfile[] {
    return Object.values(PROFILES);
}