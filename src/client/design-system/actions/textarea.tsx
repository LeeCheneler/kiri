import { type KeyboardEventHandler, useId } from "react";
import { Field } from "./field.tsx";

/**
 * Multi-line text field — a styled wrapper over the native `<textarea>`,
 * controlled via `value` / `onChange`, which receives the current text. The
 * multi-line counterpart to `TextInput`, with the same field-lockup and
 * assistive-tech wiring (label associates via a generated or supplied `id`, the
 * help line becomes `aria-describedby`, `required` sets `aria-required`) plus a
 * `rows` hint for the initial height. Pass `label` to render the lockup; omit it
 * for the bare control. `onKeyDown` is forwarded for callers that need key
 * handling (e.g. a chat composer's Enter-to-send). It owns the control's chrome
 * — and, when labelled, the field rhythm — but no width or margin.
 */
export function Textarea({
  value,
  onChange,
  id,
  name,
  label,
  description,
  required = false,
  disabled = false,
  placeholder,
  rows = 3,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const control = (
    <textarea
      id={fieldId}
      name={name}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      aria-describedby={description ? `${fieldId}-description` : undefined}
      aria-required={required ? true : undefined}
      className="resize-y border border-rule bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
  if (label === undefined) return control;
  return (
    <Field htmlFor={fieldId} label={label} description={description} required={required}>
      {control}
    </Field>
  );
}
