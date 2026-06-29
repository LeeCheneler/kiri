import { type ReactNode, useId } from "react";

/** One choice in a {@link SegmentedControl}. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * A horizontal row of mutually-exclusive segments — the control for choosing one
 * value from a short, fixed set when seeing all the options at once matters
 * (allow / ask / off, day / week / month). Controlled via `value` / `onChange`,
 * which receives the chosen value. Each segment wraps a visually-hidden native
 * radio sharing one group, so the radio role, arrow-key navigation, and
 * `getByRole("radio", { name })` come for free; the row carries the `radiogroup`
 * role. Pass a `label` for the field lockup (label over an optional `description`
 * help line, wired via `aria-labelledby`/`aria-describedby`), or omit it and pass
 * `aria-label` for a bare, self-labelling control. `disabled` dims and blocks the
 * whole control. For a long or open-ended set reach for `Select`; for an on/off
 * toggle, `ToggleChip`.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  name,
  label,
  description,
  "aria-label": ariaLabel,
  disabled = false,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
  label?: string;
  description?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  const labelId = useId();
  const descriptionId = useId();
  const group = (
    <div
      role="radiogroup"
      aria-label={label === undefined ? ariaLabel : undefined}
      aria-labelledby={label === undefined ? undefined : labelId}
      aria-describedby={description ? descriptionId : undefined}
      className={`inline-flex w-fit divide-x divide-rule border border-rule font-mono text-xs ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            className={`flex items-center px-3 py-1 transition-colors duration-150 has-[:focus-visible]:outline-1 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-accent ${
              selected ? "bg-accent text-canvas" : "text-ink hover:text-accent"
            } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
  if (label === undefined) return group;
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="font-mono text-xs tracking-widest text-ink-muted uppercase">
        {label}
      </span>
      {description && (
        <p id={descriptionId} className="font-display text-sm text-ink-muted italic">
          {description}
        </p>
      )}
      {group}
    </div>
  );
}
