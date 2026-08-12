import { env } from "../lib/env";

export async function searchInternet(
  query: string
) {

  const response =
    await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          api_key:
            env.tavilyApiKey,

          query,

          search_depth:
            "advanced",

          max_results:
            5,
        }),
      }
    );

    console.log(
  "[TAVILY KEY]",
  env.tavilyApiKey
);

  if (!response.ok) {

    throw new Error(
      `Tavily Error: ${response.status}`
    );

  }

  return await response.json();

}

export function
formatSearchResults(
  data: any
) {

  if (
    !data?.results
  ) {
    return "No results found.";
  }

  return data.results
    .slice(0, 5)
    .map(
      (
        result: any,
        index: number
      ) => `
Result ${index + 1}

Title:
${result.title}

URL:
${result.url}

Content:
${result.content}

-------------------
`
    )
    .join("\n");

}