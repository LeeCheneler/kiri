import { type ReactNode, useId } from "react";
import { Field } from "./field.tsx";

/**
 * Styled wrapper over the native `<select>` — the form control for choosing one
 * value from a fixed set. Stays native, so keyboard navigation, type-ahead, the
 * platform picker, and the combobox role all come for free. Write the `<option>`
 * (and `<optgroup>`) elements as children. Controlled via `value` / `onChange`,
 * which receives the selected value. Pass a `label` to render the field lockup
 * (label, optional `description` help line, and a `required` marker), wired for
 * assistive tech; omit it for the bare control and pair it with a caller-supplied
 * `<label>` via `id`. It carries no width or margin — the field owns layout.
 */
export function Select({
  value,
  onChange,
  children,
  id,
  name,
  label,
  description,
  required = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  name?: string;
  label?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const control = (
    <select
      id={fieldId}
      name={name}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-describedby={description ? `${fieldId}-description` : undefined}
      aria-required={required ? true : undefined}
      className="cursor-pointer border border-rule bg-canvas py-2 pr-10 pl-3 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
  if (label === undefined) return control;
  return (
    <Field htmlFor={fieldId} label={label} description={description} required={required}>
      {control}
    </Field>
  );
}
