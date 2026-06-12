/**
 * Prompt used for an `llm:` summarize step that declares neither `prompt`
 * nor `prompt_file`, so `summarize: { llm: { model } }` produces feed
 * summaries with zero configuration. A completion has no tools to read
 * files with, so the run envelope is inlined via `{{KIRI_RUN_CONTEXT}}`
 * rather than referenced by path.
 */
export const DEFAULT_SUMMARY_PROMPT = `You are writing a kiri workflow run summary for an activity feed. Lead with what happened — no preamble like 'the workflow ran', no padding. Markdown is supported and encouraged.

Match the shape of the output to the shape of the result:
- If the workflow produced a list of items (for example, 'list all open PRs I need to review'), output a markdown bullet list. Each bullet is one concrete item the reader can skim — label or title first, the smallest useful detail after.
- If the workflow produced a single piece of news, output a single sentence or short paragraph.
- Use bold, inline code, and links where they help the reader scan.

The feed is glanced at, not read. Keep it dense and skimmable, with no headings.

The full run envelope follows as JSON. It contains a steps array (each with stdout and stderr) and an articles array (each with markdown content). Skim what the workflow actually produced and write the summary from that. Output only the summary itself.

{{KIRI_RUN_CONTEXT}}`;
