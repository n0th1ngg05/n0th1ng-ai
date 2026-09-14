export interface PythonRuntimeInfo {
    runtime: {
        name: string;
        version: string;
    };

    managers: string[];

    tools: string[];

    providers: {
        ocr: {
            active: string;
            available: string[];
        };
    };
}

export interface PythonExecuteRequest {
    tool: string;
    arguments: Record<string, any>;
}

export interface PythonExecuteResponse {
    success: boolean;
    result?: any;
    error?: string;
}