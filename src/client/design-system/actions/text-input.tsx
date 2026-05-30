import { useId } from "react";
import { Field } from "./field.tsx";

/**
 * Single-line text field — a styled wrapper over the native `<input type="text">`,
 * controlled via `value` / `onChange`, which receives the current text. Pass a
 * `label` to render the field lockup (label, optional `description` help line,
 * and a `required` marker), wired for assistive tech: the label associates via a
 * generated (or caller-supplied) `id`, the help line becomes the input's
 * `aria-describedby`, and `required` sets `aria-required`. Omit `label` for the
 * bare control, leaving layout and labelling to the caller. It owns the control's
 * chrome — and, when labelled, the field rhythm — but no width or margin.
 */
export function TextInput({
  value,
  onChange,
  id,
  name,
  label,
  description,
  required = false,
  disabled = false,
  placeholder,
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
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const control = (
    <input
      id={fieldId}
      name={name}
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      aria-describedby={description ? `${fieldId}-description` : undefined}
      aria-required={required ? true : undefined}
      className="border border-rule bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
  if (label === undefined) return control;
  return (
    <Field htmlFor={fieldId} label={label} description={description} required={required}>
      {control}
    </Field>
  );
}
