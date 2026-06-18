import { useId } from "react";

/**
 * A pill-shaped on/off toggle — a checkbox rendered as a chip, for compact
 * multi-select that wraps inline (filter tags, facets). Controlled via
 * `checked` / `onChange` (which receives the next boolean); the whole pill is
 * the click target, filling with the accent when on. It wraps a visually-hidden
 * native checkbox, so the checkbox role and keyboard toggle come for free and
 * `getByRole("checkbox", { name })` / `getByLabelText` resolve it. `disabled`
 * dims and blocks it. It owns its own chrome but no surrounding margin — lay
 * several out in a `flex flex-wrap` for a chip group. For a vertical list of
 * options, reach for `Checkbox` instead.
 */
export function ToggleChip({
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
      className={`inline-flex items-center rounded-full border px-3 py-1 font-mono text-xs transition-colors duration-150 has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2 ${
        checked
          ? "border-accent bg-accent text-canvas"
          : "border-rule text-ink hover:border-accent hover:text-accent"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        id={fieldId}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      {label}
    </label>
  );
}
