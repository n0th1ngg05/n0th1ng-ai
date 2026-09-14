import type { ExecutionResult } from "../executor";

export async function scientificCalculator(
    args: any
): Promise<ExecutionResult> {

    const expression = args?.expression;

    if (!expression) {
        return {
            success: false,
            error: "Missing expression",
        };
    }

    const safeExpression = expression.replace(
        /[^0-9+\-*/().,%^ eE]/g,
        ""
    );

    try {

        // eslint-disable-next-line no-eval
        const result = eval(safeExpression);

        return {
            success: true,
            result,
        };

    } catch {

        return {
            success: false,
            error: "Invalid expression",
        };

    }

}