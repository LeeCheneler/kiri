import { useMemo, useState } from "react";
import type { WorkflowInputSummary } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Select } from "../../design-system/actions/select.tsx";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";

/**
 * Collects values for a workflow's declared `inputs:` before invoking it. One
 * field per input — a `<Select>` when the input constrains to `options`, a
 * `<TextInput>` otherwise — each pre-filled from the input's `default` (or the
 * first option, so a picklist is never empty). Submit is gated until every
 * required input is non-empty.
 *
 * On submit the dialog calls `onSubmit(values)` and stays mounted while the run
 * is in flight; the caller closes it by unmounting after navigating to the new
 * run. A submit error keeps the dialog open, shows the message by the actions,
 * and re-enables the form. Built on the design-system `Modal`, so the backdrop
 * is inert, focus is trapped, and Escape / backdrop dismissal route to `onCancel`.
 *
 * `initialValues` pre-fills the fields — the re-run and recommendation flows
 * seed it from a prior run's snapshot or a recommendation's payload. Each field
 * falls back to its declared `default` (then its first option) for inputs the
 * map doesn't cover, and values for inputs the workflow no longer declares are
 * ignored. `notice`, when set, renders a short note above the fields (e.g. a
 * re-run's "previous attempt will be cleared" warning).
 */
export function InvokeModal({
  workflowName,
  inputs,
  initialValues,
  notice,
  onSubmit,
  onCancel,
}: {
  workflowName: string;
  inputs: WorkflowInputSummary[];
  initialValues?: Record<string, string>;
  notice?: string;
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const seededValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const input of inputs) {
      // Prefer a supplied value, then the declared default; a picklist always
      // reports its first option as its value, so seed that as the last resort
      // to keep the payload valid.
      map[input.name] = initialValues?.[input.name] ?? input.default ?? input.options?.[0] ?? "";
    }
    return map;
  }, [inputs, initialValues]);

  const [values, setValues] = useState<Record<string, string>>(seededValues);
  const [state, setState] = useState<"idle" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const allRequiredFilled = inputs.every(
    (input) => !input.required || (values[input.name] ?? "").length > 0,
  );

  const setValue = (name: string, next: string) => setValues((prev) => ({ ...prev, [name]: next }));

  const submit = async () => {
    if (!allRequiredFilled || state === "submitting") return;
    setState("submitting");
    setErrorMessage(null);
    try {
      await onSubmit(values);
      // Stay "submitting" until the parent unmounts us on navigation;
      // resetting here would flash the button back mid-route.
    } catch (err) {
      setState("idle");
      setErrorMessage(err instanceof Error ? err.message : "trigger failed");
    }
  };

  return (
    <Modal title={`run ${workflowName}`} onClose={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-5"
      >
        {notice ? (
          <p role="note" className="font-mono text-xs leading-relaxed text-ink-muted">
            {notice}
          </p>
        ) : null}
        {inputs.map((input) =>
          input.options ? (
            <Select
              key={input.name}
              label={input.name}
              description={input.description}
              required={input.required}
              value={values[input.name] ?? ""}
              onChange={(next) => setValue(input.name, next)}
            >
              {input.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : (
            <TextInput
              key={input.name}
              label={input.name}
              description={input.description}
              required={input.required}
              value={values[input.name] ?? ""}
              onChange={(next) => setValue(input.name, next)}
            />
          ),
        )}
        <div>
          {errorMessage && (
            <p role="alert" className="mb-3 font-mono text-sm text-status-failed">
              {errorMessage}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <Button variant="dismissive" onClick={onCancel}>
              cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              pending={state === "submitting"}
              pendingLabel="running…"
              disabled={!allRequiredFilled}
            >
              run →
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
