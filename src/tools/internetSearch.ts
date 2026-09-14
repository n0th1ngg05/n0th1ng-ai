import {
    searchInternet,
    formatSearchResults,
} from "./tavily";

import type { ExecutionResult } from "../executor";

export async function internetSearch(
    args: any
): Promise<ExecutionResult> {

    const query = args?.query;

    if (!query) {

        return {
            success: false,
            error: "Missing query",
        };

    }

    const raw =
        await searchInternet(query);

    return {

        success: true,

        result:
            formatSearchResults(raw),

    };

}