import { type WorkflowStep, isLlmStep, isUseStep } from "../workflows/index.ts";

// Per-stream cap on a step's stdout / an article's markdown within the
// digest. The digest travels as a single env entry and gets inlined into
// prompts, so unbounded streams would blow the OS exec limit and model
// context windows long before they trouble anything else.
const STREAM_CAP = 64 * 1024;
const TRUNCATION_MARKER = "\n[truncated]";

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
 * One executed step as rendered into the summary digest. `step` is the
 * authored definition (for the label); `stdout` is the captured output.
 */
export interface SummaryContextStep {
  step: WorkflowStep;
  index: number;
  durationMs: number;
  stdout: string;
}

/** An article already produced when the summariser starts. */
export interface SummaryContextArticle {
  slug: string;
  name: string;
  content_md: string;
}

export interface SummaryContextInput {
  workflow: string;
  durationMs: number;
  steps: SummaryContextStep[];
  articles: SummaryContextArticle[];
}

/**
 * Label for a step's digest section: the authored `name`, falling back to
 * `id`, then the step's ident — bundle ref, model id, or the script's
 * first non-empty line. Mirrors the fallback order the run timeline uses.
 */
export const summaryStepLabel = (step: WorkflowStep): string => {
  if (step.name !== undefined) return step.name;
  if (step.id !== undefined) return step.id;
  if (isUseStep(step)) return step.use;
  if (isLlmStep(step)) return step.llm.model;
  const firstLine = step.sh.split("\n").find((line) => line.trim() !== "");
  return firstLine?.trim() ?? step.sh;
};

const formatDuration = (durationMs: number): string =>
  durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;

/**
 * Render the plain-text run digest injected into `summarize:` steps as
 * `KIRI_SUMMARY_CONTEXT`. This is the gist plane: prompt-ready prose with
 * each step's stdout and each article's markdown independently capped at
 * 64 KB (`[truncated]` marker) so the env entry stays well under the OS
 * exec size limit. A summarizer that needs an output at full fidelity
 * should take it through a `{ step: <id> }` / `{ article: <slug> }` ref
 * instead — the data plane is never truncated.
 */
export function buildSummaryContext(input: SummaryContextInput): string {
  const sections: string[] = [
    `Workflow: ${input.workflow}`,
    `Duration: ${formatDuration(input.durationMs)}`,
  ];

  for (const entry of input.steps) {
    const heading = `## Step ${entry.index} — ${summaryStepLabel(entry.step)} (${formatDuration(entry.durationMs)})`;
    const body = entry.stdout.trim() === "" ? "(no output)" : truncateStream(entry.stdout).trim();
    sections.push(`${heading}\n\n${body}`);
  }

  for (const article of input.articles) {
    const heading = `## Article: ${article.name} (${article.slug})`;
    sections.push(`${heading}\n\n${truncateStream(article.content_md).trim()}`);
  }

  return sections.join("\n\n");
}
