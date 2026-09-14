import { performResearch } from "./research";
import type { ExecutionResult } from "../executor";

export async function researchQuery(
    args: any
): Promise<ExecutionResult> {

    const query = args?.query;

    if (!query) {
        return {
            success: false,
            error: "Missing query",
        };
    }

    try {

        const result = await performResearch(query);

        return {
            success: true,
            result,
        };

    } catch (err: any) {

        return {
            success: false,
            error: err?.message ?? "Research failed",
        };

    }

}