import { isOpenRouterModel, generateWithOpenRouter } from "./openRouter";

type ConversationMessage = {
  role: string;
  content: string;
};

export async function summarizeConversation(
  messages: ConversationMessage[],
  model: string
): Promise<string> {

  if (messages.length === 0) {
    return "";
  }

  const conversation = messages
    .map(
      (message) =>
`${message.role.toUpperCase()}:

${message.content}`
    )
    .join("\n\n");

  const prompt = `
You are an expert conversation summarizer.

Your objective is to compress long conversations while preserving everything important.

Your summary MUST preserve:

- User preferences
- User profile information
- Important facts
- Ongoing projects
- Technical discussions
- Design decisions
- APIs, libraries and technologies discussed
- Problems encountered
- Solutions implemented
- Pending tasks
- Future plans
- Important conclusions

Do NOT include:

- Greetings
- Small talk
- Repeated information
- Filler conversation
- Casual acknowledgements

Rules:

- Write concise bullet points.
- Keep technical accuracy.
- Preserve chronological context when important.
- Never invent information.
- Keep the summary under 500 words.
- The summary should be sufficient for another AI to continue the conversation naturally.

Conversation:

${conversation}
`;

  // ── Route to OpenRouter or Ollama ──────────────────────────────────────────
  if (isOpenRouterModel(model)) {
    return await generateWithOpenRouter(model, prompt);
  }

  const response =
    await fetch(
      "http://localhost:11434/api/generate",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          model,
          prompt,
          stream: false,
        }),
      }
    );

  if (!response.ok) {
    throw new Error(
      "Conversation summary generation failed"
    );
  }

  const data =
    await response.json();

  return (
    data.response?.trim() ??
    ""
  );
}