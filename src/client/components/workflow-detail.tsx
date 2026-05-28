import { type ReactNode, useState } from "react";
import { useSearchParams } from "wouter";
import type {
  EnvValue,
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
import { SectionHeader } from "./ui/section-header.tsx";
import { WORKFLOW_TAB_PARAM, type WorkflowTabDef, WorkflowTabs } from "./workflow-tabs.tsx";

/** Tab id holding the YAML definition; the hero's "view definition" action selects it. */
const YAML_TAB_ID = "yaml";

const SH_LABEL_LIMIT = 60;

type LabelSource = { use: string } | { sh: string };

const sourceLabel = (entry: LabelSource): string => {
  if ("use" in entry) return `use: ${entry.use}`;
  const firstLine = entry.sh.split("\n", 1)[0]?.trim() ?? "";
  const truncated =
    firstLine.length > SH_LABEL_LIMIT ? `${firstLine.slice(0, SH_LABEL_LIMIT)}…` : firstLine;
  return `sh: ${truncated}`;
};

const hasEnv = (env: Record<string, EnvValue> | undefined): env is Record<string, EnvValue> =>
  env !== undefined && Object.keys(env).length > 0;

// Render a single env value: literal strings pass through; structured
// `{ input: <name> }` refs render in YAML-flavoured form so the reader
// sees the same shape they wrote in the workflow file.
const renderEnvValue = (value: EnvValue): ReactNode =>
  typeof value === "string" ? value : `{ input: ${value.input} }`;

const stepCountLabel = (count: number): string => (count === 1 ? "1 step" : `${count} steps`);

const articleCountLabel = (count: number): string =>
  count === 1 ? "1 article" : `${count} articles`;

/**
 * Editorial detail view for one workflow definition. Opens on a hero
 * lockup — a grouping eyebrow, the workflow name in italic Fraunces, an
 * optional description deck, and the run / view-definition actions —
 * above a tab strip. The structured definition (steps, publish,
 * summariser) lives in the rightmost "YAML definition" tab; the other
 * tabs hold placeholder copy until their dedicated views land.
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
  const [, setParams] = useSearchParams();

  const viewDefinition = () => {
    setParams(
      (prev) => {
        prev.set(WORKFLOW_TAB_PARAM, YAML_TAB_ID);
        return prev;
      },
      { replace: true },
    );
  };

  const tabs: WorkflowTabDef[] = [
    {
      id: "recent",
      label: "Recent runs",
      content: <EmptyState>recent runs are coming soon.</EmptyState>,
    },
    {
      id: "inputs",
      label: "Inputs",
      content: <EmptyState>the inputs view is coming soon.</EmptyState>,
    },
    {
      id: "steps",
      label: "Steps",
      content: <EmptyState>the steps view is coming soon.</EmptyState>,
    },
    {
      id: "summariser",
      label: "Summariser",
      content: <EmptyState>the summariser view is coming soon.</EmptyState>,
    },
    {
      id: YAML_TAB_ID,
      label: "YAML definition",
      content: <DefinitionPanel workflow={workflow} />,
    },
  ];

  return (
    <article>
      <BackLink href="/">all activity</BackLink>

      <WorkflowHero workflow={workflow} onTrigger={onTrigger} onViewDefinition={viewDefinition} />

      <WorkflowTabs tabs={tabs} rightTabId={YAML_TAB_ID} />
    </article>
  );
}

/**
 * The structured workflow definition rendered inside the "YAML
 * definition" tab: the ordered steps, then the optional publish and
 * summarise sections. Every entry renders the same config blocks
 * (description, source, env) so the panel reads as one rhythm of
 * identical units.
 */
function DefinitionPanel({ workflow }: { workflow: WorkflowSummary }) {
  const stepCount = workflow.steps.length;
  return (
    <>
      <section>
        <SectionHeader title="Steps" meta={stepCountLabel(stepCount)} />
        {stepCount === 0 ? (
          <EmptyState>no steps defined.</EmptyState>
        ) : (
          <ol className="divide-y divide-rule">
            {workflow.steps.map((step, index) => (
              <li
                // Steps have no identity at the definition level; combine
                // ordinal with the step's primary subject so identical
                // sh: lines or repeat use: bundles still produce distinct keys.
                key={`${index}:${"use" in step ? `use:${step.use}` : `sh:${step.sh}`}`}
                style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                className="animate-[feed-row-in_320ms_ease-out_backwards]"
              >
                <EntryRow
                  entry={step}
                  identityLines={[
                    <span key="step" className="flex items-baseline gap-5">
                      <span className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 font-mono text-sm text-ink">
                        {sourceLabel(step)}
                      </span>
                    </span>,
                  ]}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {workflow.publish && workflow.publish.length > 0 && (
        <PublishSection entries={workflow.publish} />
      )}

      {workflow.summarize && <SummariseSection step={workflow.summarize} />}
    </>
  );
}

function SummariseSection({ step }: { step: WorkflowStepSummary }) {
  return (
    <section className="mt-12">
      <SectionHeader title="Summarise" />
      <EntryRow
        entry={step}
        identityLines={[
          <span key="src" className="font-mono text-sm text-ink">
            {sourceLabel(step)}
          </span>,
        ]}
      />
    </section>
  );
}

function PublishSection({ entries }: { entries: WorkflowPublishSummary[] }) {
  return (
    <section className="mt-12">
      <SectionHeader title="Publish" meta={articleCountLabel(entries.length)} />
      <ul className="divide-y divide-rule">
        {entries.map((entry) => (
          <li key={entry.name}>
            <EntryRow
              entry={entry}
              title={entry.title}
              identityLines={[
                <span key="name" className="font-mono text-sm text-ink">
                  {`name: ${entry.name}`}
                </span>,
                <span key="src" className="font-mono text-sm text-ink">
                  {sourceLabel(entry)}
                </span>,
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Workflow page hero. A grouping eyebrow (keyed off the workflow's
 * optional `group`, falling back to a static label), the workflow name
 * in italic Fraunces, an optional description deck, and a row of
 * actions: a primary run affordance plus a "view definition" button
 * that switches the tab strip to the YAML definition tab.
 *
 * The run button opens the invoke modal for workflows declaring
 * `inputs:` and fires the run directly otherwise; in-flight and error
 * state live here so the button reflects the trigger's progress.
 */
function WorkflowHero({
  workflow,
  onTrigger,
  onViewDefinition,
}: {
  workflow: WorkflowSummary;
  onTrigger: (name: string, inputs?: Record<string, string>) => Promise<unknown>;
  onViewDefinition: () => void;
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
      <div className="mt-6 flex flex-wrap items-baseline gap-3">
        <Button pending={state === "running"} pendingLabel="running…" onClick={handleRun}>
          {hasInputs ? "run with inputs" : "run"}
        </Button>
        <button
          type="button"
          onClick={onViewDefinition}
          className="border border-rule px-3 py-1.5 font-mono text-xs text-ink outline-none transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
        >
          view definition
        </button>
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

type EntryShape = { description?: string; env?: Record<string, EnvValue> } & (
  | { use: string }
  | { sh: string }
);

/**
 * Render one workflow entry (step, publish, summariser) with a shared
 * layout: optional editorial title, a stack of mono identity lines
 * (ordinal, name, source label), and then the standard config blocks —
 * description, inline sh source, and env — keyed in small caps.
 */
function EntryRow({
  entry,
  title,
  identityLines,
}: {
  entry: EntryShape;
  title?: string;
  identityLines: ReactNode[];
}) {
  return (
    <div className="relative flex flex-col gap-3 px-5 py-4">
      <span aria-hidden="true" className="absolute inset-y-2 left-1 w-0.5 bg-rule" />
      {title && <h4 className="font-display text-2xl text-ink leading-tight">{title}</h4>}
      <div className="flex flex-col gap-1">{identityLines}</div>
      <EntryConfig entry={entry} />
    </div>
  );
}

/**
 * Renders the optional description / inline `sh:` source / env map for a
 * step, publish entry, or summariser. Each block only appears when its
 * value is populated, so callers don't need to gate the render themselves.
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
          <pre className="font-mono text-xs break-words whitespace-pre-wrap text-ink">
            {(entry as { sh: string }).sh}
          </pre>
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
