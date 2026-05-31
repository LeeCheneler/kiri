import { type ReactNode, useState } from "react";
import { useLocation } from "wouter";
import {
  ApiError,
  type RunDetailRun,
  type WorkflowInputSummary,
  cancelRun,
  deleteRun,
  rerunRun,
} from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { InvokeModal } from "../run-workflow/invoke-modal.tsx";

const RERUN_NOTICE = "The previous attempt's steps and traces will be cleared.";

/**
 * The run-level controls on the detail header. While the run is in flight the
 * only action is cancelling it; once terminal it can be re-run or deleted.
 *
 * Re-running a workflow that declares inputs opens the invoke modal pre-filled
 * from this run's snapshotted inputs (so a re-run tweaks rather than retypes);
 * a workflow with no declared inputs re-runs straight from a confirm. Re-run is
 * disabled when the workflow is no longer in the registry, since there's
 * nothing to run against. Delete confirms, then navigates home once the run is
 * gone — a 404 counts as already-deleted. Failures surface inline; the shared
 * run live-sync flips the page out of these states, so a pending button simply
 * unmounts when the run's status next changes.
 */
export function RunActions({
  run,
  workflowInputs,
}: {
  run: RunDetailRun;
  workflowInputs?: WorkflowInputSummary[];
}) {
  if (run.status === "running") {
    return <CancelAction id={run.id} />;
  }
  return <TerminalActions run={run} workflowInputs={workflowInputs} />;
}

function CancelAction({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCancel = async () => {
    setError(null);
    setPending(true);
    try {
      await cancelRun(id);
      // The cancelled status arrives over SSE and unmounts this; stay pending
      // until then rather than flashing the button back.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <ActionBar error={error}>
      <Button variant="negative" pending={pending} pendingLabel="cancelling…" onClick={onCancel}>
        cancel run
      </Button>
    </ActionBar>
  );
}

function TerminalActions({
  run,
  workflowInputs,
}: {
  run: RunDetailRun;
  workflowInputs?: WorkflowInputSummary[];
}) {
  const [, navigate] = useLocation();
  const [rerunPending, setRerunPending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const hasInputs = (workflowInputs?.length ?? 0) > 0;

  const handleRerun = async () => {
    if (hasInputs) {
      // The modal's submit is the confirmation gesture for the inputs path.
      setError(null);
      setModalOpen(true);
      return;
    }
    if (!window.confirm(`Run again? ${RERUN_NOTICE}`)) return;
    setError(null);
    setRerunPending(true);
    try {
      await rerunRun(run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setRerunPending(false);
    }
  };

  const handleModalSubmit = async (values: Record<string, string>) => {
    // A rejection propagates to the modal's inline error; success closes it.
    await rerunRun(run.id, values);
    setModalOpen(false);
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this run? This cannot be undone.")) return;
    setError(null);
    setDeletePending(true);
    try {
      await deleteRun(run.id);
    } catch (cause) {
      // Already gone (another tab, a stale view) — intent satisfied, fall
      // through to navigate home. Any other failure surfaces inline.
      if (!(cause instanceof ApiError) || cause.status !== 404) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setDeletePending(false);
        return;
      }
    }
    navigate("/");
  };

  return (
    <>
      <ActionBar error={error}>
        <Button
          pending={rerunPending}
          pendingLabel="starting…"
          disabled={run.isInterrupted}
          title={
            run.isInterrupted ? "the workflow no longer exists; re-create it first" : undefined
          }
          onClick={handleRerun}
        >
          run again
        </Button>
        <Button
          variant="negative"
          pending={deletePending}
          pendingLabel="deleting…"
          onClick={handleDelete}
        >
          delete
        </Button>
      </ActionBar>
      {modalOpen && workflowInputs ? (
        <InvokeModal
          workflowName={run.workflowName}
          inputs={workflowInputs}
          initialValues={run.inputs ?? undefined}
          notice={RERUN_NOTICE}
          onSubmit={handleModalSubmit}
          onCancel={() => setModalOpen(false)}
        />
      ) : null}
    </>
  );
}

function ActionBar({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">{children}</div>
      {error ? (
        <p role="alert" className="font-mono text-xs text-status-failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
