import { type ReactNode, useState } from "react";
import { Link } from "wouter";
import type { WorkflowPublishSummary, WorkflowStepSummary, WorkflowSummary } from "../api.ts";

const SH_LABEL_LIMIT = 60;

type LabelSource = { use: string } | { sh: string };

const sourceLabel = (entry: LabelSource): string => {
  if ("use" in entry) return `use: ${entry.use}`;
  const firstLine = entry.sh.split("\n", 1)[0]?.trim() ?? "";
  const truncated =
    firstLine.length > SH_LABEL_LIMIT ? `${firstLine.slice(0, SH_LABEL_LIMIT)}…` : firstLine;
  return `sh: ${truncated}`;
};

const hasEnv = (env: Record<string, string> | undefined): env is Record<string, string> =>
  env !== undefined && Object.keys(env).length > 0;

const stepCountLabel = (count: number): string => (count === 1 ? "1 step" : `${count} steps`);

const articleCountLabel = (count: number): string =>
  count === 1 ? "1 article" : `${count} articles`;

/**
 * Editorial detail view for one workflow definition. Header carries the
 * name in Fraunces with a trigger affordance set in the accent token.
 * Step count, article count (when the workflow publishes), summariser
 * presence, gating, and schedule are listed alongside it in mono small
 * caps so the reader sees the run shape at a glance.
 *
 * Every entry — step, publish, summariser — renders the same config
 * blocks (description, source, env) using one shared component so the
 * page reads as a single rhythm of identical units.
 *
 * `onTrigger` returns a promise so the button can show the in-flight
 * state until the run resolves; the route owns navigating to the run
 * detail on success.
 */
export function WorkflowDetailView({
  workflow,
  onTrigger,
}: {
  workflow: WorkflowSummary;
  onTrigger: (name: string) => Promise<unknown>;
}) {
  const stepCount = workflow.steps.length;
  const publishCount = workflow.publish?.length ?? 0;
  return (
    <article>
      <Link
        href="/"
        className="font-mono text-xs tracking-widest text-ink-muted uppercase no-underline transition-colors duration-150 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
      >
        ← all activity
      </Link>

      <header className="relative mt-6 pl-6">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-rule" />
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-4xl text-ink leading-tight">{workflow.name}</h2>
          <TriggerButton name={workflow.name} onTrigger={onTrigger} />
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
          {workflow.schedule && (
            <>
              <HeaderSeparator />
              <div className="flex items-baseline">
                <dt className="sr-only">schedule</dt>
                <dd className="text-ink italic">{workflow.schedule}</dd>
              </div>
            </>
          )}
        </dl>
      </header>

      <section className="mt-12">
        <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
          <h3 className="text-xs tracking-widest text-ink-muted uppercase">Steps</h3>
          <span className="font-mono text-xs text-ink-muted tabular-nums">
            {stepCountLabel(stepCount)}
          </span>
        </header>
        {stepCount === 0 ? (
          <p className="font-display text-base text-ink-muted italic">no steps defined.</p>
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
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Summarise</h3>
      </header>
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
      <header className="mb-6 flex items-baseline justify-between border-b border-rule pb-3">
        <h3 className="text-xs tracking-widest text-ink-muted uppercase">Publish</h3>
        <span className="font-mono text-xs text-ink-muted tabular-nums">
          {articleCountLabel(entries.length)}
        </span>
      </header>
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
  name,
  onTrigger,
}: {
  name: string;
  onTrigger: (name: string) => Promise<unknown>;
}) {
  const [state, setState] = useState<"idle" | "running">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setState("running");
    setErrorMessage(null);
    try {
      await onTrigger(name);
      setState("idle");
    } catch (err) {
      setState("idle");
      setErrorMessage(err instanceof Error ? err.message : "trigger failed");
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={state === "running"}
        className="cursor-pointer font-mono text-xs tracking-widest text-accent uppercase no-underline outline-none transition-colors duration-150 hover:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:text-ink-muted"
      >
        {state === "running" ? (
          <span className="inline-flex items-baseline gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 animate-pulse self-center rounded-full bg-status-running"
            />
            running…
          </span>
        ) : (
          "run →"
        )}
      </button>
      {errorMessage && (
        <p role="alert" className="font-mono text-xs text-status-failed">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

type EntryShape = { description?: string; env?: Record<string, string> } & (
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
            {Object.entries(entry.env as Record<string, string>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-4">
                  <dt className="w-40 shrink-0 text-ink-muted">{k}</dt>
                  <dd className="min-w-0 flex-1 break-words text-ink">{v}</dd>
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
