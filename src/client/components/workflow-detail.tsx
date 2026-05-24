import { type ReactNode, useState } from "react";
import type {
  EnvValue,
  WorkflowPublishSummary,
  WorkflowStepSummary,
  WorkflowSummary,
} from "../api.ts";
import { InvokeModal } from "./invoke-modal.tsx";
import { Actions } from "./ui/actions.tsx";
import { BackLink } from "./ui/back-link.tsx";
import { Button } from "./ui/button.tsx";
import { EmptyState } from "./ui/empty-state.tsx";
import { SectionHeader } from "./ui/section-header.tsx";

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
 * Editorial detail view for one workflow definition. Header carries the
 * name in Fraunces with a trigger affordance set in the accent token.
 * Step count, article count (when the workflow publishes), summariser
 * presence, and gating are listed alongside it in mono small caps so
 * the reader sees the run shape at a glance.
 *
 * Every entry — step, publish, summariser — renders the same config
 * blocks (description, source, env) using one shared component so the
 * page reads as a single rhythm of identical units.
 *
 * `onTrigger` returns a promise so the button can show the in-flight
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
  const stepCount = workflow.steps.length;
  const publishCount = workflow.publish?.length ?? 0;
  return (
    <article>
      <BackLink href="/">all activity</BackLink>

      <header className="relative mt-6 pl-6">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-rule" />
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-4xl text-ink leading-tight">{workflow.name}</h2>
          <TriggerButton workflow={workflow} onTrigger={onTrigger} />
        </div>
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-muted">
          <HeaderFact label="steps" value={stepCountLabel(stepCount)} />
          {publishCount > 0 && (
            <>
              <HeaderSeparator />
              <HeaderFact label="articles" value={articleCountLabel(publishCount)} />
            </>
          )}
          {workflow.summarize && (
            <>
              <HeaderSeparator />
              <HeaderFact label="summariser" value="summarised" />
            </>
          )}
          {workflow.gating && (
            <>
              <HeaderSeparator />
              <HeaderFact label="gating" value={`gating: ${workflow.gating}`} />
            </>
          )}
        </dl>
      </header>

      <section className="mt-12">
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
    </article>
  );
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline">
      <dt className="sr-only">{label}</dt>
      <dd className="tracking-widest uppercase">{value}</dd>
    </div>
  );
}

function HeaderSeparator() {
  return (
    <span aria-hidden="true" className="text-rule">
      ·
    </span>
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

function TriggerButton({
  workflow,
  onTrigger,
}: {
  workflow: WorkflowSummary;
  onTrigger: (name: string, inputs?: Record<string, string>) => Promise<unknown>;
}) {
  const hasInputs = workflow.inputs && workflow.inputs.length > 0;
  const [state, setState] = useState<"idle" | "running">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const handleClick = async () => {
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

  return (
    <>
      <Actions errorMessage={errorMessage}>
        <Button pending={state === "running"} pendingLabel="running…" onClick={handleClick}>
          run →
        </Button>
      </Actions>
      {modalOpen && workflow.inputs && (
        <InvokeModal
          workflowName={workflow.name}
          inputs={workflow.inputs}
          onSubmit={handleModalSubmit}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </>
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
        <Block label="description">
          <p className="font-display text-base text-ink italic">{entry.description}</p>
        </Block>
      )}
      {showSource && (
        <Block label="source">
          <pre className="font-mono text-xs break-words whitespace-pre-wrap text-ink">
            {(entry as { sh: string }).sh}
          </pre>
        </Block>
      )}
      {showEnv && (
        <Block label="env">
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
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-xs tracking-widest text-ink-muted uppercase">{label}</h4>
      <div className="mt-2 border-l-2 border-rule py-1 pl-3">{children}</div>
    </div>
  );
}
