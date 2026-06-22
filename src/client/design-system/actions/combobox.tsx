import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Field } from "./field.tsx";

const LISTBOX_CLASS =
  "absolute z-20 mt-1 max-h-60 w-full overflow-auto border border-rule bg-paper py-1 shadow-lg";
const OPTION_CLASS =
  "cursor-pointer px-3 py-2 font-mono text-sm text-ink aria-selected:text-accent hover:bg-paper-2";
const OPTION_ACTIVE_CLASS = `${OPTION_CLASS} bg-paper-2`;

/** An option with a display label distinct from its committed value. */
export interface ComboboxItem {
  value: string;
  label: string;
}

/**
 * Searchable single-select — a combobox over a long list of values. The input
 * filters the options as you type (case-insensitive substring); ↑/↓ move the
 * highlight, Enter or a click commits the highlighted option, and Escape or a
 * click outside closes without changing the value. Driven by `value` /
 * `onChange`, which receives the chosen option's value; `options` is the full
 * set of selectable entries — a bare `string` (its own label and value) or a
 * `{ value, label }` pair when the display label differs from the committed
 * value. Pass a `label` to render the field
 * lockup (label, optional `description` help line, `required` marker), wired for
 * assistive tech through the ARIA combobox/listbox roles; omit it for the bare
 * control. Reach for it over `Select` when the list is long enough that scanning
 * a native dropdown is painful. It carries no width or margin — the field owns
 * layout.
 */
export function Combobox({
  value,
  onChange,
  options,
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
  options: readonly (string | ComboboxItem)[];
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
  const listboxId = `${fieldId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Normalise to {value,label}: a bare string is its own label and value.
  const items: ComboboxItem[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  // The committed value's label for the closed input; falls back to the raw
  // value when it isn't among the options (e.g. a pinned but now-absent entry).
  const selectedLabel = items.find((item) => item.value === value)?.label ?? value;

  // Open, the input shows the live filter and the list narrows to matches;
  // closed, it shows the committed value and the full set stands by.
  const filtered = open
    ? items.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
    : items;
  // Filtering can shrink the list past the highlight; clamp it so the active
  // option and Enter always agree on a real row.
  const active = Math.min(activeIndex, Math.max(0, filtered.length - 1));
  const activeOptionId = open && filtered[active] ? `${listboxId}-option-${active}` : undefined;

  const openList = () => {
    setQuery("");
    setActiveIndex(
      Math.max(
        0,
        items.findIndex((item) => item.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const commit = (item: ComboboxItem) => {
    onChange(item.value);
    close();
  };

  // A pointer-down anywhere outside the control dismisses the open list, leaving
  // the value untouched — the same as Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the keyboard highlight in view as it walks a list taller than the popup.
  useEffect(() => {
    if (activeOptionId)
      document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (open) setActiveIndex(Math.min(active + 1, filtered.length - 1));
      else openList();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) setActiveIndex(Math.max(active - 1, 0));
      else openList();
    } else if (event.key === "Enter" && open && filtered[active]) {
      event.preventDefault();
      commit(filtered[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    }
  };

  const control = (
    <div ref={rootRef} className="relative">
      <input
        id={fieldId}
        name={name}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-describedby={description ? `${fieldId}-description` : undefined}
        aria-required={required ? true : undefined}
        autoComplete="off"
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={openList}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="dropdown-chevron w-full cursor-text border border-rule bg-canvas py-2 pr-10 pl-3 font-mono text-sm text-ink outline-none focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      {open ? (
        // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox pattern — the listbox isn't focusable and isn't a native <select>; focus stays on the input, which drives selection through aria-activedescendant.
        <ul id={listboxId} role="listbox" className={LISTBOX_CLASS}>
          {filtered.length === 0 ? (
            <li role="presentation" className="px-3 py-2 font-mono text-sm text-ink-faint italic">
              No matches
            </li>
          ) : (
            filtered.map((item, index) => (
              <ComboboxOption
                key={item.value}
                id={`${listboxId}-option-${index}`}
                label={item.label}
                selected={item.value === value}
                active={index === active}
                onSelect={() => commit(item)}
              />
            ))
          )}
        </ul>
      ) : null}
    </div>
  );

  if (label === undefined) return control;
  return (
    <Field htmlFor={fieldId} label={label} description={description} required={required}>
      {control}
    </Field>
  );
}

// A single listbox option. Split out so the interactive-role lint exceptions the
// aria-activedescendant pattern requires sit on one line, under one rationale.
function ComboboxOption({
  id,
  label,
  selected,
  active,
  onSelect,
}: {
  id: string;
  label: string;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const className = active ? OPTION_ACTIVE_CLASS : OPTION_CLASS;
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useSemanticElements lint/a11y/noNoninteractiveElementToInteractiveRole lint/a11y/useKeyWithClickEvents: ARIA combobox pattern — options aren't focusable and aren't native <option>s; focus stays on the input (selection via aria-activedescendant and the input's Enter handler), the click only adds a pointer affordance.
    <li id={id} role="option" aria-selected={selected} onClick={onSelect} className={className}>
      {label}
    </li>
  );
}
