const PYTHON_RUNTIME = "http://127.0.0.1:8002";

export class PythonRuntimeClient {

    async health() {

        const res = await fetch(`${PYTHON_RUNTIME}/health`);

        return res.json();
    }

    async info() {

        const res = await fetch(`${PYTHON_RUNTIME}/info`);

        return res.json();
    }

    async execute(tool: string, payload: any) {

        const res = await fetch(`${PYTHON_RUNTIME}/execute`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                tool,
                arguments: payload
            })
        });

        return res.json();
    }

}

export const pythonRuntimeClient =
    new PythonRuntimeClient();