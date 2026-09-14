import { scientificCalculator } from "./tools/scientificCalculator";
import { internetSearch } from "./tools/internetSearch";
import { researchQuery } from "./tools/researchQuery";
import { urlReader } from "./tools/urlReader";

import { PYTHON_TOOLS } from "./pythonTools";
import { forwardTool } from "./toolGateway";

export interface ExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
}

export async function executeTool(
    toolCall: any
): Promise<ExecutionResult> {

    const {

        tool,

        arguments: args

    } = toolCall;

    /*
    -----------------------------------------
    Python Runtime Tools
    -----------------------------------------
    */

    if (PYTHON_TOOLS.has(tool)) {

        return await forwardTool({

            url: "/execute",

            method: "POST",

            body: {

                tool,

                arguments: args,

            },

        });

    }

    /*
    -----------------------------------------
    Native Worker Tools
    -----------------------------------------
    */

    switch (tool) {

        case "scientific_calculator":

            return scientificCalculator(args);

        case "internet_search":

            return internetSearch(args);

        case "url_reader":

            return urlReader(args);

        case "research_query":

            return researchQuery(args);

        default:

            return {

                success: false,

                error: `Worker doesn't support '${tool}'.`

            };

    }

}