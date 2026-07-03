// Per-stream cap on a step's stdout/stderr. The run-context JSON gets
// inlined into prompts, so unbounded streams blow context windows long
// before they trouble the API transport.
const STREAM_CAP = 64 * 1024;
const TRUNCATION_MARKER = "\n[truncated]";

/** One executed step's outcome as serialised into the run-context JSON. */
export interface RunContextStep {
  kind: "use" | "sh" | "llm";
  use?: string;
  sh?: string;
  llm?: unknown;
  index: number;
  status: "ok" | "failed" | "cancelled";
  durationMs: number;
  stdout: string;
  stderr: string;
  error: { message: string; stack?: string } | null;
}

/** A publish article already produced when the consuming step starts. */
export interface RunContextArticle {
  slug: string;
  name: string;
  content_md: string;
}

/** The run envelope handed to publish/summarize steps. */
export interface RunContext {
  workflow: string;
  status: "ok" | "failed" | "cancelled";
  startedAt: string;
  durationMs: number;
  steps: RunContextStep[];
  articles: RunContextArticle[];
}

export function truncateStream(value: string): string {
  if (value.length <= STREAM_CAP) return value;
  let head = value.slice(0, STREAM_CAP);
  // slice() cuts at a UTF-16 code-unit index, so a character encoded as a
  // surrogate pair (emoji etc.) can be split in half at the cap. A kept
  // half ends with a high surrogate (0xd800–0xdbff); drop it so the
  // output stays well-formed Unicode rather than carrying an orphan that
  // strict consumers reject or mangle to U+FFFD.
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return head + TRUNCATION_MARKER;
}

/**
 * Serialise a run context to pretty-printed JSON with each step's
 * `stdout`/`stderr` independently capped at 64 KB, marked `[truncated]`
 * where the cap bites. Article content is left whole.
 */
export function buildRunContext(context: RunContext): string {
  return JSON.stringify(
    {
      ...context,
      steps: context.steps.map((step) => ({
        ...step,
        stdout: truncateStream(step.stdout),
        stderr: truncateStream(step.stderr),
      })),
    },
    null,
    2,
  );
}
