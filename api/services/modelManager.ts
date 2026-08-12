export async function
getInstalledModels() {

  const response =
    await fetch(
      "http://localhost:11434/api/tags"
    );

  const data =
    await response.json();

  return data.models ?? [];

}