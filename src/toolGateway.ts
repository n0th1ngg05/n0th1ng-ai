const PYTHON_RUNTIME = "http://127.0.0.1:8002";

export interface ToolHttpRequest {

    url: string;

    method?: "GET" | "POST";

    headers?: Record<string, string>;

    body?: unknown;

}

export async function forwardTool(
    request: ToolHttpRequest
): Promise<Response> {

    return fetch(

        `${PYTHON_RUNTIME}${request.url}`,

        {

            method: request.method ?? "POST",

            headers: {

                "Content-Type": "application/json",

                ...(request.headers ?? {}),

            },

            body:

                request.body !== undefined

                    ? JSON.stringify(request.body)

                    : undefined,

        }

    );

}