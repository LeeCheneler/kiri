import { useState } from "react";
import { Link } from "wouter";
import {
  type RecommendationSummary,
  type WorkflowSummary,
  actionRecommendation,
} from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Status } from "../../design-system/feedback/status.tsx";
import { InvokeModal } from "../run-workflow/invoke-modal.tsx";

/**
 * The run's "Recommended" section: the follow-up workflow invocations it
 * proposed, each a launch pad. Hidden entirely when the run produced none.
 * An untriggered recommendation is a trigger button (disabled with a tooltip
 * when its target workflow has left the registry); triggering one that declares
 * inputs opens the invoke modal pre-filled from the recommendation's payload,
 * otherwise it fires straight away. Once triggered the row becomes a
 * status-badged link to the spawned run — the badge tracks that run live via
 * the shared run sync, so no local state survives the action.
 */
export function RunRecommendations({
  runId,
  recommendations,
  workflows,
}: {
  runId: string;
  recommendations: RecommendationSummary[];
  workflows: WorkflowSummary[];
}) {
  if (recommendations.length === 0) return null;
  return (
    <section className="mt-10">
      <Eyebrow tone="muted">Recommended</Eyebrow>
      <ul className="mt-3 divide-y divide-rule border-rule border-t border-b">
        {recommendations.map((rec) => (
          <li key={rec.id}>
            <RecommendationRow
              runId={runId}
              rec={rec}
              workflow={workflows.find((w) => w.name === rec.workflow)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecommendationRow({
  runId,
  rec,
  workflow,
}: {
  runId: string;
  rec: RecommendationSummary;
  workflow: WorkflowSummary | undefined;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const missing = workflow === undefined;
  const hasInputs = (workflow?.inputs?.length ?? 0) > 0;

  const handleTrigger = async () => {
    if (hasInputs) {
      // The modal's submit is the confirmation gesture for the inputs path.
      setError(null);
      setModalOpen(true);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await actionRecommendation(runId, rec.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  const handleModalSubmit = async (values: Record<string, string>) => {
    // A rejection propagates to the modal's inline error; success closes it.
    await actionRecommendation(runId, rec.id, values);
    setModalOpen(false);
  };

  // Triggered: the row is a status-badged link to the spawned run.
  if (rec.actionedRunId !== null && rec.actionedRunStatus !== null) {
    return (
      <Link
        href={`/runs/${rec.actionedRunId}`}
        className="group flex items-center gap-4 px-4 py-4 no-underline outline-none transition-colors hover:bg-paper focus-visible:bg-paper focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
      >
        <RecommendationBody rec={rec} accentOnHover />
        <span className="shrink-0 text-xs">
          <Status status={rec.actionedRunStatus} />
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-sm text-ink-muted transition-colors group-hover:text-accent group-focus-visible:text-accent"
        >
          →
        </span>
      </Link>
    );
  }

  return (
    <>
      <div className="flex items-center gap-4 px-4 py-4">
        <RecommendationBody rec={rec} />
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            pending={pending}
            pendingLabel="starting…"
            disabled={missing}
            title={missing ? "workflow not found" : undefined}
            onClick={handleTrigger}
          >
            run →
          </Button>
          {error ? (
            <p role="alert" className="font-mono text-xs text-status-failed">
              {error}
            </p>
          ) : null}
        </div>
      </div>
      {modalOpen && workflow?.inputs ? (
        <InvokeModal
          workflowName={workflow.name}
          inputs={workflow.inputs}
          initialValues={rec.inputs ?? undefined}
          onSubmit={handleModalSubmit}
          onCancel={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}

function RecommendationBody({
  rec,
  accentOnHover = false,
}: {
  rec: RecommendationSummary;
  accentOnHover?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p
        className={`font-display text-lg leading-tight text-ink ${
          accentOnHover
            ? "transition-colors group-hover:text-accent group-focus-visible:text-accent"
            : ""
        }`}
      >
        {rec.title}
      </p>
      {rec.description ? (
        <p className="mt-1 font-mono text-xs leading-relaxed text-ink-muted">{rec.description}</p>
      ) : null}
    </div>
  );
}
