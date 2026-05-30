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
 */
export function InvokeModal({
  workflowName,
  inputs,
  onSubmit,
  onCancel,
}: {
  workflowName: string;
  inputs: WorkflowInputSummary[];
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const initialValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const input of inputs) {
      // A picklist always reports its first option as its value, so seed it
      // with options[0] when no default applies — keeping the payload valid.
      map[input.name] = input.default ?? input.options?.[0] ?? "";
    }
    return map;
  }, [inputs]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
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
