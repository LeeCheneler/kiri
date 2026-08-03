import { useState } from "react";
import { useLocation } from "wouter";
import { type WorkflowSummary, triggerRun } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { InvokeModal } from "./invoke-modal.tsx";

/**
 * The run action for a workflow. Workflows with no declared `inputs:` run
 * straight from the button — the button shows its in-flight state until the run
 * resolves — while workflows declaring inputs open a modal to collect them
 * first. Either way this owns the trigger: it POSTs the run and navigates to the
 * new run's detail on success. A failed bare run surfaces inline beneath the
 * button; a failed modal run surfaces inside the still-open modal. `size`
 * follows Button's scale — `lg` (default) as a page's headline action, `sm`
 * when the control sits inside a dense row.
 */
export function RunWorkflow({
  workflow,
  size = "lg",
}: {
  workflow: WorkflowSummary;
  size?: "sm" | "lg";
}) {
  const [, navigate] = useLocation();
  const hasInputs = workflow.inputs !== undefined && workflow.inputs.length > 0;
  const [state, setState] = useState<"idle" | "running">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const runWith = async (inputs?: Record<string, string>) => {
    const result = await triggerRun(workflow.name, inputs);
    navigate(`/runs/${result.runId}`);
  };

  const handleRun = async () => {
    if (hasInputs) {
      setModalOpen(true);
      return;
    }
    setState("running");
    setErrorMessage(null);
    try {
      await runWith();
      setState("idle");
    } catch (err) {
      setState("idle");
      setErrorMessage(err instanceof Error ? err.message : "trigger failed");
    }
  };

  return (
    <div>
      <Button
        variant="primary"
        size={size}
        pending={state === "running"}
        pendingLabel="running…"
        onClick={handleRun}
      >
        run
      </Button>
      {errorMessage && (
        <p role="alert" className="mt-3 font-mono text-sm text-status-failed">
          {errorMessage}
        </p>
      )}
      {modalOpen && workflow.inputs && (
        <InvokeModal
          workflowName={workflow.name}
          inputs={workflow.inputs}
          onSubmit={runWith}
          onCancel={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
