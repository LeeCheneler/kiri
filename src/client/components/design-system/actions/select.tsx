import type { ReactNode } from "react";

/**
 * Styled wrapper over the native `<select>` — the form control for choosing one
 * value from a fixed set. Stays native, so keyboard navigation, type-ahead, the
 * platform picker, and the combobox role all come for free; it owns the
 * control's chrome only. Write the `<option>` (and `<optgroup>`) elements as
 * children. Controlled via `value` / `onChange`, which receives the selected
 * value. Pass `id` to associate a caller-supplied `<label>`. It carries no width
 * or margin — the surrounding field owns layout.
 */
export function Select({
  value,
  onChange,
  children,
  id,
  name,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  id?: string;
  name?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="cursor-pointer border border-rule bg-canvas py-2 pr-10 pl-3 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </select>
  );
}
