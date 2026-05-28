import { type ReactNode, useState } from "react";
import type {
  EnvValue,
  WorkflowInputSummary,
  WorkflowPublishSummary,
  WorkflowStepSummary,
  WorkflowSummary,
} from "../api.ts";
import { InvokeModal } from "./invoke-modal.tsx";
import { BackLink } from "./ui/back-link.tsx";
import { Button } from "./ui/button.tsx";
import { EmptyState } from "./ui/empty-state.tsx";
import { ErrorMessage } from "./ui/error-message.tsx";
import { LabelledBlock } from "./ui/labelled-block.tsx";
import { TextButton } from "./ui/text-button.tsx";
import { WorkflowRecentRuns } from "./workflow-recent-runs.tsx";
import { WorkflowStats } from "./workflow-stats.tsx";
import { type WorkflowTabDef, WorkflowTabs } from "./workflow-tabs.tsx";

const SH_LABEL_LIMIT = 60;

type LabelSource = { use: string } | { sh: string };

const stepKind = (entry: LabelSource): "sh" | "use" => ("use" in entry ? "use" : "sh");

// The Steps/Summariser tab rows show the kind and title as separate
// elements, so this returns the title alone: the bundle reference for a
// `use:` step, or the first non-empty line of an `sh:` script truncated
// to the label limit.
const stepTitle = (entry: LabelSource): string => {
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

// Render a single env value: literal strings pass through; structured
// `{ input: <name> }` refs render in YAML-flavoured form so the reader
// sees the same shape they wrote in the workflow file.
const renderEnvValue = (value: EnvValue): ReactNode =>
  typeof value === "string" ? value : `{ input: ${value.input} }`;

/**
 * Editorial detail view for one workflow definition. Opens on a hero
 * lockup — a grouping eyebrow, the workflow name in italic Fraunces, an
 * optional description deck, and the run action — followed by an
 * at-a-glance stats panel and then a tab strip whose panels hold the
 * workflow's recent runs and typed read-only views of its inputs,
 * steps, summariser, and publishes.
 *
 * `onTrigger` returns a promise so the run button can show the in-flight
 * state until the run resolves; the route owns navigating to the run
 * detail on success. Workflows declaring `inputs:` collect values via
 * a modal before invoking — the second argument carries that map; it
 * is omitted on workflows without an `inputs:` block.
 */
export function WorkflowDetailView({
  workflow,
  onTrigger,
}: {
  workflow: WorkflowSummary;
  onTrigger: (name: string, inputs?: Record<string, string>) => Promise<unknown>;
}) {
  const tabs: WorkflowTabDef[] = [
    {
      id: "recent",
      label: "Recent runs",
      content: <WorkflowRecentRuns workflowName={workflow.name} />,
    },
    {
      id: "inputs",
      label: "Inputs",
      content: <InputsPanel inputs={workflow.inputs} />,
    },
    {
      id: "steps",
      label: "Steps",
      content: <StepsPanel steps={workflow.steps} />,
    },
    {
      id: "summariser",
      label: "Summariser",
      content: <SummariserPanel summarize={workflow.summarize} />,
    },
    {
      id: "publishes",
      label: "Publishes",
      content: <PublishesPanel entries={workflow.publish} />,
    },
  ];

  return (
    <article>
      <BackLink href="/">all activity</BackLink>

      <WorkflowHero workflow={workflow} onTrigger={onTrigger} />

      <WorkflowStats workflowName={workflow.name} />

      <WorkflowTabs tabs={tabs} />
    </article>
  );
}

/**
 * The Inputs tab body: a row per declared input — name, derived kind
 * (`enum` when the input constrains to `options`, else `string`), and a
 * required/optional badge — with the input's `default` and description
 * stacked beneath when set. Workflows with no `inputs:` block show an
 * empty state instead.
 */
function InputsPanel({ inputs }: { inputs?: WorkflowInputSummary[] }) {
  if (!inputs || inputs.length === 0) {
    return <EmptyState>this workflow declares no inputs.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-rule">
      {inputs.map((input) => (
        <li key={input.name} className="flex flex-col gap-2 px-5 py-4">
          <div className="flex items-baseline gap-5">
            <span className="min-w-0 flex-1 font-mono text-sm text-ink">{input.name}</span>
            <span className="shrink-0 font-mono text-xs text-ink-muted">
              {input.options ? "enum" : "string"}
            </span>
            <span
              className={`shrink-0 font-mono text-xs ${
                input.required ? "text-accent" : "text-ink-faint"
              }`}
            >
              {input.required ? "required" : "opt"}
            </span>
          </div>
          {input.default !== undefined && (
            <p className="font-mono text-xs text-ink-muted">
              default <span className="text-ink">{input.default}</span>
            </p>
          )}
          {input.description !== undefined && input.description.length > 0 && (
            <p className="font-display text-sm text-ink-muted italic">{input.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The Steps tab body: the workflow's steps in declared order. Each row
 * pairs a two-digit ordinal with the step's kind (`sh` or `use`) and a
 * title — the bundle reference for `use:` steps, the first non-empty
 * line of the script for `sh:` steps — followed by the shared config
 * blocks (description, inline source, env). Workflows with no steps
 * show an empty state.
 */
function StepsPanel({ steps }: { steps: WorkflowStepSummary[] }) {
  if (steps.length === 0) {
    return <EmptyState>this workflow declares no steps.</EmptyState>;
  }
  return (
    <ol className="divide-y divide-rule">
      {steps.map((step, index) => (
        <li
          // Steps have no identity; combine the ordinal with the step's
          // primary subject so repeats still produce distinct keys.
          key={`${index}:${"use" in step ? `use:${step.use}` : `sh:${step.sh}`}`}
          className="flex flex-col gap-2 px-5 py-4"
        >
          <div className="flex items-baseline gap-5">
            <span className="shrink-0 font-mono text-xs text-ink-faint tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="shrink-0 font-mono text-xs text-ink-muted uppercase">
              {stepKind(step)}
            </span>
            <span className="min-w-0 flex-1 font-mono text-sm text-ink">{stepTitle(step)}</span>
          </div>
          <EntryConfig entry={step} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The Summariser tab body: when the workflow declares a `summarize:`
 * step, render it as a single step-style row (kind and title) followed
 * by the shared config blocks (description, inline source, env);
 * otherwise an empty state.
 */
function SummariserPanel({ summarize }: { summarize?: WorkflowStepSummary }) {
  if (!summarize) {
    return <EmptyState>this workflow has no summariser configured.</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <div className="flex items-baseline gap-5">
        <span className="shrink-0 font-mono text-xs text-ink-muted uppercase">
          {stepKind(summarize)}
        </span>
        <span className="min-w-0 flex-1 font-mono text-sm text-ink">{stepTitle(summarize)}</span>
      </div>
      <EntryConfig entry={summarize} />
    </div>
  );
}

/**
 * The Publishes tab body: a row per declared `publish:` entry — the
 * resolved editorial title, then a mono line pairing the kebab `name`
 * with the entry's kind and source reference, followed by the shared
 * config blocks (description, inline source, env). Workflows that
 * publish nothing show an empty state.
 */
function PublishesPanel({ entries }: { entries?: WorkflowPublishSummary[] }) {
  if (!entries || entries.length === 0) {
    return <EmptyState>this workflow publishes no articles.</EmptyState>;
  }
  return (
    <ul className="divide-y divide-rule">
      {entries.map((entry) => (
        <li key={entry.name} className="flex flex-col gap-2 px-5 py-4">
          <h4 className="font-display text-2xl text-ink leading-tight">{entry.title}</h4>
          <div className="flex items-baseline gap-5">
            <span className="shrink-0 font-mono text-xs text-ink-faint">{entry.name}</span>
            <span className="shrink-0 font-mono text-xs text-ink-muted uppercase">
              {stepKind(entry)}
            </span>
            <span className="min-w-0 flex-1 font-mono text-sm text-ink">{stepTitle(entry)}</span>
          </div>
          <EntryConfig entry={entry} />
        </li>
      ))}
    </ul>
  );
}

type EntryShape = { description?: string; env?: Record<string, EnvValue> } & (
  | { use: string }
  | { sh: string }
);

/** Line count beyond which an inline source starts collapsed. */
const SOURCE_COLLAPSE_LINES = 4;

/**
 * Inline `sh:` source viewer. Short scripts render in full; scripts past
 * the collapse threshold start clipped behind a fade with an
 * expand/collapse toggle, so a long script doesn't dominate the panel.
 * The threshold is a line count rather than a measured height because
 * the render target the tests run against has no layout.
 */
function SourceBlock({ source }: { source: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = source.split("\n").length > SOURCE_COLLAPSE_LINES;
  const pre = (
    <pre className="font-mono text-xs break-words whitespace-pre-wrap text-ink">{source}</pre>
  );
  if (!collapsible) return pre;
  return (
    <div>
      <div className={`relative ${expanded ? "" : "max-h-16 overflow-hidden"}`}>
        {pre}
        {!expanded && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-b from-transparent to-canvas"
          />
        )}
      </div>
      <div className="mt-2">
        <TextButton tone="accent" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "collapse" : "expand"}
        </TextButton>
      </div>
    </div>
  );
}

/**
 * Renders the optional description / inline `sh:` source / env map shared
 * by the Steps, Summariser, and Publishes tab rows. Each block only
 * appears when its value is populated, so callers don't gate the render
 * themselves. Env keys sort alphabetically and structured input
 * references render in `{ input: <name> }` form.
 */
function EntryConfig({ entry }: { entry: EntryShape }) {
  const showDescription = entry.description !== undefined && entry.description.length > 0;
  const showSource = "sh" in entry;
  const showEnv = hasEnv(entry.env);
  if (!showDescription && !showSource && !showEnv) return null;
  return (
    <div className="space-y-4">
      {showDescription && (
        <LabelledBlock label="description">
          <p className="font-display text-base text-ink italic">{entry.description}</p>
        </LabelledBlock>
      )}
      {showSource && (
        <LabelledBlock label="source">
          <SourceBlock source={(entry as { sh: string }).sh} />
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

/**
 * Workflow page hero. A grouping eyebrow (keyed off the workflow's
 * optional `group`, falling back to a static label), the workflow name
 * in italic Fraunces, an optional description deck, and a primary run
 * action.
 *
 * The run button opens the invoke modal for workflows declaring
 * `inputs:` and fires the run directly otherwise; in-flight and error
 * state live here so the button reflects the trigger's progress.
 */
function WorkflowHero({
  workflow,
  onTrigger,
}: {
  workflow: WorkflowSummary;
  onTrigger: (name: string, inputs?: Record<string, string>) => Promise<unknown>;
}) {
  const hasInputs = workflow.inputs !== undefined && workflow.inputs.length > 0;
  const [state, setState] = useState<"idle" | "running">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleRun = async () => {
    if (hasInputs) {
      setModalOpen(true);
      return;
    }
    setState("running");
    setErrorMessage(null);
    try {
      await onTrigger(workflow.name);
      setState("idle");
    } catch (err) {
      setState("idle");
      setErrorMessage(err instanceof Error ? err.message : "trigger failed");
    }
  };

  const handleModalSubmit = async (values: Record<string, string>) => {
    await onTrigger(workflow.name, values);
    // Stay open until the parent unmounts us via navigation; on error
    // the modal handles its own inline error state and re-enables submit.
  };

  const eyebrow = workflow.group ? `${workflow.group} · Workflow` : "Workflow";

  return (
    <header className="mt-6 border-rule border-b pb-8">
      <p className="font-mono text-xs text-accent uppercase tracking-widest">{eyebrow}</p>
      <h2 className="mt-2 font-display text-[64px] text-ink italic leading-[0.95] tracking-tight">
        {workflow.name}
      </h2>
      {workflow.description && (
        <p className="mt-4 max-w-[56ch] font-display text-lg text-ink-muted italic leading-[1.45]">
          {workflow.description}
        </p>
      )}
      <div className="mt-6">
        <Button
          variant="solid"
          size="lg"
          pending={state === "running"}
          pendingLabel="running…"
          onClick={handleRun}
        >
          {hasInputs ? "run with inputs" : "run"}
        </Button>
      </div>
      <ErrorMessage message={errorMessage} />
      {modalOpen && workflow.inputs && (
        <InvokeModal
          workflowName={workflow.name}
          inputs={workflow.inputs}
          onSubmit={handleModalSubmit}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </header>
  );
}
