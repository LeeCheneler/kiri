import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { WorkflowInputSummary } from "../api.ts";

/**
 * Modal that collects values for a workflow's declared `inputs:` before
 * invoking it. One field per input — label is the input's name, help
 * text is the description (when present), required inputs are marked,
 * and `default` pre-fills the field at open time. Free-text inputs
 * render as a single-line `<input type="text">`; picklist inputs
 * (those declaring `options`) render as a `<select>` constrained to
 * the declared values.
 *
 * `initialValues`, when supplied, overrides the per-input default on a
 * key-by-key basis (the re-run flow uses this to pre-fill from a prior
 * run's snapshotted inputs). Keys not present in the map still fall
 * back to the input's `default`, so callers can hand a partial map.
 *
 * `notice`, when supplied, renders a short caution line under the
 * heading — the re-run flow uses this to warn that the prior attempt's
 * steps and traces will be cleared, mirroring the bare path's confirm
 * prompt.
 *
 * Submit is gated until every required input is non-empty. On submit
 * the dialog calls `onSubmit(values)` and stays mounted while the run
 * is in flight; the caller (the workflow page) closes the dialog by
 * unmounting it after navigating to the new run's detail page. On a
 * submit error the dialog stays open, renders the message near the
 * submit button, and re-enables the form.
 *
 * Built on top of the native `<dialog>` element opened via
 * `showModal()`, so the background is inert, focus is trapped, Escape
 * closes the dialog, and focus is restored to the trigger when the
 * dialog unmounts — all without a custom keydown handler.
 */
export function InvokeModal({
  workflowName,
  inputs,
  initialValues: initialOverrides,
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
  const initialValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const input of inputs) {
      // Picklist inputs never sit "empty" — a `<select>` always reports
      // its first <option> as value, so fall back to options[0] when
      // neither an override nor a declared default applies. This keeps
      // the gathered payload always-valid against the input's options.
      const picklistFallback = input.options?.[0];
      map[input.name] = initialOverrides?.[input.name] ?? input.default ?? picklistFallback ?? "";
    }
    return map;
  }, [inputs, initialOverrides]);

  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [state, setState] = useState<"idle" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const firstSelectRef = useRef<HTMLSelectElement>(null);
  const headingId = useId();

  // Open as a true modal dialog: background becomes inert, focus is
  // trapped inside, Escape closes via the `cancel` event, and focus
  // returns to the previously-focused element on close.
  useEffect(() => {
    dialogRef.current?.showModal();
    (firstFieldRef.current ?? firstSelectRef.current)?.focus();
  }, []);

  const allRequiredFilled = inputs.every(
    (input) => !input.required || (values[input.name] ?? "").length > 0,
  );

  const submit = async () => {
    if (!allRequiredFilled || state === "submitting") return;
    setState("submitting");
    setErrorMessage(null);
    try {
      await onSubmit(values);
      // Stay in "submitting" until the parent unmounts us — the route
      // navigates on success, which tears this component down. Resetting
      // to "idle" here would flash the button back to "run →" mid-route.
    } catch (err) {
      setState("idle");
      setErrorMessage(err instanceof Error ? err.message : "trigger failed");
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is the dialog's native `cancel` event below (fires on Escape); the click handler only adds backdrop dismissal.
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      // The dialog element ships its own `cancel` event for Escape; route
      // it through `onCancel` so the parent controls unmount.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      // Backdrop clicks land on the dialog element itself, not the inner
      // card. Translate that into a cancel so the user can dismiss by
      // clicking outside, matching native expectation for modal dialogs.
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel();
      }}
      // Tailwind's preflight zeros the dialog's UA `margin: auto`, which is
      // what natively centers an open <dialog>; restore it explicitly. The
      // entrance keyframe lives in app.css alongside the backdrop one — both
      // play once when `showModal()` adds the `open` attribute on mount.
      // `text-left` anchors content alignment so the dialog is unaffected
      // by any `text-right` (or RTL) inherited from the mount point's
      // ancestors — the dialog opens in the top layer visually but stays
      // a DOM child where it's rendered, and `text-align` inherits.
      className="m-auto w-full max-w-md animate-[modal-in_180ms_ease-out] border border-rule bg-paper p-6 text-left text-ink shadow-xl backdrop:bg-canvas/80"
    >
      <h2 id={headingId} className="font-display text-2xl text-ink leading-tight">
        run {workflowName}
      </h2>
      {notice && (
        <p
          role="note"
          className="mt-3 border-l-2 border-status-failed py-1 pl-3 font-mono text-xs text-ink-muted normal-case"
        >
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="mt-6 flex flex-col gap-5"
      >
        {inputs.map((input, index) => {
          const fieldId = `invoke-input-${input.name}`;
          const helpId = input.description ? `${fieldId}-help` : undefined;
          const isFirstField = index === 0;
          const handleChange = (next: string) =>
            setValues((prev) => ({ ...prev, [input.name]: next }));
          return (
            <div key={input.name} className="flex flex-col gap-1.5">
              <label
                htmlFor={fieldId}
                className="font-mono text-xs tracking-widest text-ink-muted uppercase"
              >
                {input.name}
                {input.required && (
                  <span aria-label="required" className="ml-1 text-accent">
                    *
                  </span>
                )}
              </label>
              {input.description && (
                <p id={helpId} className="font-display text-sm text-ink-muted italic">
                  {input.description}
                </p>
              )}
              {input.options ? (
                <select
                  ref={isFirstField ? firstSelectRef : undefined}
                  id={fieldId}
                  value={values[input.name] ?? ""}
                  onChange={(event) => handleChange(event.target.value)}
                  aria-describedby={helpId}
                  aria-required={input.required ? true : undefined}
                  className="border border-rule bg-canvas py-2 pr-10 pl-3 font-mono text-sm text-ink outline-none focus-visible:border-accent"
                >
                  {input.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  ref={isFirstField ? firstFieldRef : undefined}
                  id={fieldId}
                  type="text"
                  value={values[input.name] ?? ""}
                  onChange={(event) => handleChange(event.target.value)}
                  aria-describedby={helpId}
                  aria-required={input.required ? true : undefined}
                  className="border border-rule bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:border-accent"
                />
              )}
            </div>
          );
        })}
        <div className="mt-2 flex flex-col items-end gap-2">
          <div className="flex items-baseline gap-4">
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer font-mono text-xs tracking-widest text-ink-muted uppercase transition-colors duration-150 hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!allRequiredFilled || state === "submitting"}
              className="cursor-pointer font-mono text-xs tracking-widest text-accent uppercase transition-colors duration-150 hover:text-ink focus-visible:outline-1 focus-visible:outline-accent focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:text-ink-muted"
            >
              {state === "submitting" ? (
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
          </div>
          {errorMessage && (
            <p role="alert" className="font-mono text-xs text-status-failed">
              {errorMessage}
            </p>
          )}
        </div>
      </form>
    </dialog>
  );
}
