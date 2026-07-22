import type { ReactNode } from "react";
import type { EnvValue, LlmConfigSummary } from "../../api.ts";
import { Code, CodeBlock } from "../../design-system/content/code.tsx";

const SH_LABEL_LIMIT = 60;

type LabelSource = ({ use: string } | { sh: string } | { llm: { model: string } }) & {
  name?: string;
};

/** The kind tag for a step-shaped entry: a bundle reference, an inline script, or an LLM completion. */
export const stepKind = (entry: LabelSource): "sh" | "use" | "llm" => {
  if ("use" in entry) return "use";
  if ("llm" in entry) return "llm";
  return "sh";
};

/**
 * The title for a step-shaped entry: the explicit `name` when set, else the
 * bundle reference for a `use:` entry, the model id for an `llm:` entry, or
 * the first non-empty line of an `sh:` script truncated to the label limit.
 */
export const stepTitle = (entry: LabelSource): string => {
  if (entry.name) return entry.name;
  if ("use" in entry) return entry.use;
  if ("llm" in entry) return entry.llm.model;
  const firstNonEmpty =
    entry.sh
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "";
  return firstNonEmpty.length > SH_LABEL_LIMIT
    ? `${firstNonEmpty.slice(0, SH_LABEL_LIMIT)}…`
    : firstNonEmpty;
};

const hasEnv = (env: Record<string, EnvValue> | undefined): env is Record<string, EnvValue> =>
  env !== undefined && Object.keys(env).length > 0;

// Literal strings pass through; structured refs — `{ input: <name> }`,
// `{ step: <id> }`, `{ step: <id>, output: <name> }`, `{ article: <slug> }` —
// render in YAML-flavoured form so the reader sees the shape they wrote in
// the workflow.
const renderEnvValue = (value: EnvValue): string => {
  if (typeof value === "string") return value;
  if ("input" in value) return `{ input: ${value.input} }`;
  if ("step" in value) {
    return value.output !== undefined
      ? `{ step: ${value.step}, output: ${value.output} }`
      : `{ step: ${value.step} }`;
  }
  return `{ article: ${value.article} }`;
};

function LabelledBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-xs tracking-widest text-ink-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

type EntryShape = { description?: string; env?: Record<string, EnvValue> } & (
  | { use: string }
  | { sh: string }
  | { llm: LlmConfigSummary }
);

/**
 * The expanded body of a schema entry: the bundle reference for a `use:` entry
 * or the model id for an `llm:` entry, its optional description, inline `sh:`
 * source or `llm:` prompt (inline text or file path), and env map — each shown
 * only when populated. The whole entry already sits behind a disclosure, so the
 * source renders in full rather than collapsing again. Env keys sort
 * alphabetically and structured references render in the YAML-flavoured form
 * they were written in: `{ input: <name> }`, `{ step: <id> }`, `{ article: <slug> }`.
 */
export function EntryConfig({ entry }: { entry: EntryShape }) {
  const showReference = "use" in entry;
  const llm = "llm" in entry ? entry.llm : undefined;
  const showDescription = entry.description !== undefined && entry.description.length > 0;
  const showSource = "sh" in entry;
  const showEnv = hasEnv(entry.env);
  return (
    <div className="space-y-4">
      {showReference && (
        <LabelledBlock label={stepKind(entry)}>
          <span className="font-mono text-sm">
            <Code>{(entry as { use: string }).use}</Code>
          </span>
        </LabelledBlock>
      )}
      {llm && (
        <LabelledBlock label="model">
          <span className="font-mono text-sm">
            <Code>{llm.model}</Code>
          </span>
        </LabelledBlock>
      )}
      {showDescription && (
        <LabelledBlock label="description">
          <p className="font-display text-base text-ink italic">{entry.description}</p>
        </LabelledBlock>
      )}
      {showSource && (
        <LabelledBlock label={stepKind(entry)}>
          <CodeBlock>{(entry as { sh: string }).sh}</CodeBlock>
        </LabelledBlock>
      )}
      {llm?.prompt !== undefined && (
        <LabelledBlock label="prompt">
          <CodeBlock>{llm.prompt}</CodeBlock>
        </LabelledBlock>
      )}
      {llm?.prompt_file !== undefined && (
        <LabelledBlock label="prompt file">
          <span className="font-mono text-sm">
            <Code>{llm.prompt_file}</Code>
          </span>
        </LabelledBlock>
      )}
      {showEnv && (
        <LabelledBlock label="env">
          <dl className="space-y-1 font-mono text-xs">
            {Object.entries(entry.env as Record<string, EnvValue>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-4">
                  <dt className="w-40 shrink-0 text-ink-muted">{k}</dt>
                  <dd className="min-w-0 flex-1 break-words text-ink">{renderEnvValue(v)}</dd>
                </div>
              ))}
          </dl>
        </LabelledBlock>
      )}
    </div>
  );
}
