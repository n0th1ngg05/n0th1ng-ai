export async function
getRunningModels() {

  const response =
    await fetch(
      "http://localhost:11434/api/ps"
    );

  return await response.json();

}