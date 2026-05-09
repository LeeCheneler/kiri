import { type ReactNode, useState } from "react";
import { Link } from "wouter";
import type { WorkflowStepSummary, WorkflowSummary } from "../api.ts";

const SH_LABEL_LIMIT = 60;

const stepLabel = (step: WorkflowStepSummary): string => {
  if ("use" in step) return `use: ${step.use}`;
  const firstLine = step.sh.split("\n", 1)[0]?.trim() ?? "";
  const truncated =
    firstLine.length > SH_LABEL_LIMIT ? `${firstLine.slice(0, SH_LABEL_LIMIT)}…` : firstLine;
  return `sh: ${truncated}`;
};

const hasEnv = (env: Record<string, string> | undefined): env is Record<string, string> =>
  env !== undefined && Object.keys(env).length > 0;

const stepCountLabel = (count: number): string => (count === 1 ? "1 step" : `${count} steps`);

/**
 * Editorial detail view for one workflow definition. Header carries the
 * name in Fraunces with a trigger affordance set in the accent token,
 * step count + gating in mono small caps and schedule (when present) in
 * mono italic. Each step lays out flat — number, kind label, then the
 * inline source (for `sh:`) and env map (when populated) below.
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
          <div className="flex items-baseline">
            <dt className="sr-only">steps</dt>
            <dd className="tracking-widest uppercase">{stepCountLabel(stepCount)}</dd>
          </div>
          {workflow.gating && (
            <>
              <span aria-hidden="true" className="text-rule">
                ·
              </span>
              <div className="flex items-baseline">
                <dt className="sr-only">gating</dt>
                <dd className="tracking-widest uppercase">gating: {workflow.gating}</dd>
              </div>
            </>
          )}
          {workflow.schedule && (
            <>
              <span aria-hidden="true" className="text-rule">
                ·
              </span>
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
                <StepRow step={step} index={index} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
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

function StepRow({ step, index }: { step: WorkflowStepSummary; index: number }) {
  const stepNumber = String(index + 1).padStart(2, "0");
  const env = step.env;
  const showSource = "sh" in step;
  const showEnv = hasEnv(env);
  return (
    <div className="relative flex flex-col gap-3 px-5 py-4">
      <span aria-hidden="true" className="absolute inset-y-2 left-1 w-0.5 bg-rule" />
      <div className="flex items-baseline gap-5">
        <span className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">{stepNumber}</span>
        <span className="min-w-0 flex-1 font-mono text-sm text-ink">{stepLabel(step)}</span>
      </div>
      {(showSource || showEnv) && (
        <div className="space-y-4 pl-12">
          {"sh" in step && (
            <Block label="source">
              <pre className="font-mono text-xs break-words whitespace-pre-wrap text-ink">
                {step.sh}
              </pre>
            </Block>
          )}
          {showEnv && (
            <Block label="env">
              <dl className="space-y-1 font-mono text-xs">
                {Object.entries(env as Record<string, string>)
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
