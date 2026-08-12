import { executeClusterSpeech } from "../services/clusterSpeech";


export interface SpeechHttpRequest {

    url: string;

    method?: "GET" | "POST";

    headers?: Record<string, string>;

    body?: unknown;

}

class SpeechHttpClient {

    async request<T>(
        request: SpeechHttpRequest
    ): Promise<T> {

        const response = await executeClusterSpeech(

    request,

    async () => {

        return await fetch(

            request.url,

            {

                method: request.method ?? "POST",

                headers: {

                    "Content-Type": "application/json",

                    ...(request.headers ?? {}),

                },

                body:

                    request.body

                        ? JSON.stringify(request.body)

                        : undefined,

            }

        );

    }

);

        if (!response.ok) {

            throw new Error(

                `Speech HTTP Error ${response.status}`

            );

        }

        return await response.json();

    }

    async get<T>(
        url: string
    ) {

        return this.request<T>({
            url,
            method: "GET",
        });

    }

    async post<T>(
        url: string,

        body: unknown
    ) {

        return this.request<T>({
            url,
            method: "POST",
            body,
        });

    }

}

export const speechHttpClient =
    new SpeechHttpClient();