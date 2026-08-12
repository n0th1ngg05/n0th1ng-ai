# Standard Tool Definition Template

Use this structure when adding a new tool to `selectTool.ts`.
Keep each section as short as possible — the model is small (600M params).
Every extra line costs attention.

---

## Step 1 — Add to TOOL REFERENCE section

Paste this block after the relevant existing tool, maintaining the `──────` separator above it:

```
tool_name
USE: [trigger conditions as comma-separated keywords — keep to 1 line]
TRIGGER WORDS: [optional — only for tools like research_query where specific words shift the decision]
PHRASES: [optional — only for intent-sensitive tools like memory tools where exact user phrasing matters]
DO NOT USE: [optional — only if overlap with another tool makes exclusions necessary]
ARGS: { "param": "<short placeholder>", "param2": "<short placeholder>" }
```

### Field rules

| Field          | Required | When to include                                                          |
|----------------|----------|--------------------------------------------------------------------------|
| `USE`          | Always   | Core trigger conditions. Keywords only, no sentences.                    |
| `TRIGGER WORDS`| Optional | Add when specific words (research, compare, analyze) must force this tool |
| `PHRASES`      | Optional | Add when user phrasing (not just topic) determines which tool to call    |
| `DO NOT USE`   | Optional | Add when tool is easily confused with an existing one                    |
| `ARGS`         | Always   | Exact JSON shape. Every argument. Short `"<placeholder>"` values.        |

### ARGS rules

- If tool takes no arguments, write: `ARGS: {}`
- Always use angle-bracket placeholders: `"<description>"` not actual values
- Optional args: `"param": "<optional: description>"`
- Keep placeholders to 2–4 words max

---

## Step 2 — Add to DISAMBIGUATION section (if overlaps with existing tool)

If the new tool shares any scope with an existing tool, add an entry:

```
new_tool_name vs existing_tool_name
  new_tool_name      → [one line: when to use this one]
  existing_tool_name → [one line: when to use that one instead]
```

Only add disambiguation for real ambiguity. If the tool is clearly unique, skip this step.

---

## Full example — adding an `image_generator` tool

### Tool reference block

```
image_generator
USE: generate images, create artwork, draw pictures, visualize concepts, create illustrations
PHRASES: "generate an image", "draw", "create a picture", "make an image of", "visualize"
ARGS: { "prompt": "<image description>", "style": "<optional: art style>" }
```

### Disambiguation block (if knowledge_search stores past images)

```
image_generator vs knowledge_search
  image_generator  → user wants a NEW image created
  knowledge_search → user asks about previously generated or uploaded images
```

---

## Checklist before committing a new tool

- [ ] `USE` is one line of comma-separated keywords, no full sentences
- [ ] `ARGS` shows every parameter with a `"<placeholder>"` value
- [ ] If any existing tool could match the same query, a DISAMBIGUATION entry is added
- [ ] `PHRASES` is included only for memory/intent tools, not for factual/data tools
- [ ] `DO NOT USE` is included only when confusion with another tool is likely
- [ ] The new block has a `──────` separator above it

---

## What makes a bad tool definition (avoid these)

```
# BAD — too verbose, reads like prose, model loses focus
my_new_tool
USE: This tool should be used when the user is trying to do X, or when they mention
     something related to Y, or in cases where Z is relevant to the conversation.
ARGS: { "query": "the user's query string that they typed" }

# GOOD — tight, keyword-driven, clear arg shape
my_new_tool
USE: X, Y, Z
ARGS: { "query": "<search query>" }
```

```
# BAD — ARGS missing, model has to guess the JSON structure
sql_query
USE: database, records, counts, stats

# GOOD — model knows exactly what to output
sql_query
USE: database, records, counts, stats
ARGS: { "query": "<natural language query>" }
```
