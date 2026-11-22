import { OLLAMA_BASE_URL } from "../lib/cloud";
export async function
getInstalledModels() {

  const response =
    await fetch(
      `${OLLAMA_BASE_URL}/api/tags`
    );

  const data =
    await response.json();

  return data.models ?? [];

}