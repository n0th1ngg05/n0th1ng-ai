import { OLLAMA_BASE_URL } from "../lib/cloud";
export async function
getRunningModels() {

  const response =
    await fetch(
      `${OLLAMA_BASE_URL}/api/ps`
    );

  return await response.json();

}