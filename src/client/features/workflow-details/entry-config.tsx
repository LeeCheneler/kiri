import type { ReactNode } from "react";
import type { EnvValue } from "../../api.ts";
import { Code, CodeBlock } from "../../design-system/content/code.tsx";

const SH_LABEL_LIMIT = 60;

type LabelSource = ({ use: string } | { sh: string }) & { name?: string };

/** The kind tag for a step-shaped entry: a bundle reference or an inline script. */
export const stepKind = (entry: LabelSource): "sh" | "use" => ("use" in entry ? "use" : "sh");

/**
 * The title for a step-shaped entry: the explicit `name` when set, else the
 * bundle reference for a `use:` entry, or the first non-empty line of an `sh:`
 * script truncated to the label limit.
 */
export const stepTitle = (entry: LabelSource): string => {
  if (entry.name) return entry.name;
  if ("use" in entry) return entry.use;
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

// Literal strings pass through; structured `{ input: <name> }` refs render in
// YAML-flavoured form so the reader sees the shape they wrote in the workflow.
const renderEnvValue = (value: EnvValue): string =>
  typeof value === "string" ? value : `{ input: ${value.input} }`;

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
);

/**
 * The expanded body of a schema entry: the bundle reference for a `use:` entry,
 * its optional description, inline `sh:` source, and env map — each shown only
 * when populated. The whole entry already sits behind a disclosure, so the
 * source renders in full rather than collapsing again. Env keys sort
 * alphabetically and structured input references render as `{ input: <name> }`.
 */
export function EntryConfig({ entry }: { entry: EntryShape }) {
  const showReference = "use" in entry;
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
