import { useId } from "react";

/**
 * A single checkbox with an inline label — a styled wrapper over the native
 * `<input type="checkbox">`, controlled via `checked` / `onChange` (which
 * receives the next boolean). The whole label is the click target; `disabled`
 * dims the row and blocks interaction. It stays native, so the checkbox role and
 * keyboard toggle come for free and `getByRole("checkbox", { name })` /
 * `getByLabelText` resolve it. It owns its own chrome and the box-to-label gap,
 * but no surrounding margin — stack several for a multi-select.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  id,
  name,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  name?: string;
  disabled?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <label
      htmlFor={fieldId}
      className={`flex items-center gap-2 font-mono text-sm text-ink ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <input
        id={fieldId}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 accent-accent outline-none focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
      />
      {label}
    </label>
  );
}
