import { searchInternet } from "./tavily";
import { readUrl } from "./firecrawl";
import { formatPageContent } from "./firecrawl";

export async function
performResearch(
  query: string
) {

  console.log(
    "[RESEARCH QUERY]",
    query
  );

  const searchResults =
    await searchInternet(
      query
    );

  const urls =
    searchResults.results
      ?.slice(0, 3)
      ?.map(
        (r: any) =>
          r.url
      ) ?? [];

  console.log(
    "[RESEARCH URLS]",
    urls
  );

  const pages =
    await Promise.all(

      urls.map(
        async (
          url: string
        ) => {

          try {

            const page =
              await readUrl(
                url
              );

            return {
              url,
              content:
                formatPageContent(
                  page
                ),
            };

          } catch (
            error
          ) {

            console.log(
              "[RESEARCH ERROR]",
              url
            );

            return null;

          }

        }
      )

    );

  const validPages =
    pages.filter(
      Boolean
    );

  return validPages;

}