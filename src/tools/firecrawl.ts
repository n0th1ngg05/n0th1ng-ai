import FirecrawlApp
from "@mendable/firecrawl-js";

import { env }
from "../lib/env";

const firecrawl =
  new FirecrawlApp({
    apiKey:
      env.firecrawlApiKey,
  });

export async function
readUrl(
  url: string
) {

  const result =
    await firecrawl.scrapeUrl(
      url,
      {
        formats: [
          "markdown"
        ],
      }
    );

  return result;

}
export function formatPageContent(
  data: any
): string {

  if (!data) {
    return "No page content found.";
  }

  const markdown =
    data.markdown ?? "";

  if (!markdown.trim()) {
    return "No page content found.";
  }

  const cleanedContent =
    markdown

      // Remove images
      .replace(
        /!\[.*?\]\(.*?\)/g,
        ""
      )

      // Remove markdown links, keep text
      .replace(
        /\[(.*?)\]\(.*?\)/g,
        "$1"
      )

      // Remove code blocks
      .replace(
        /```[\s\S]*?```/g,
        ""
      )

      // Remove inline code
      .replace(
        /`.*?`/g,
        ""
      )

      // Remove excessive blank lines
      .replace(
        /\n{3,}/g,
        "\n\n"
      )

      // Trim whitespace
      .trim()

      // Limit size
      .substring(
        0,
        6000
      );

  return cleanedContent;
}

