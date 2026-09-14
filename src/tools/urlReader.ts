import { readUrl, formatPageContent } from "./firecrawl";
import type { ExecutionResult } from "../executor";

export async function urlReader(
    args: any
): Promise<ExecutionResult> {

    const url = args?.url;

    if (!url) {

        return {
            success: false,
            error: "Missing URL",
        };

    }

    try {

        const page = await readUrl(url);

        return {

            success: true,

            result: formatPageContent(page),

        };

    } catch (err: any) {

        return {

            success: false,

            error: err?.message ?? "Failed to read URL",

        };

    }

}