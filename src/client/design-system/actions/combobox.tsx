import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Field } from "./field.tsx";

const LISTBOX_CLASS =
  "absolute z-20 max-h-60 w-full overflow-auto border border-rule bg-paper py-1 shadow-lg";
const OPTION_CLASS =
  "cursor-pointer px-3 py-2 font-mono text-sm text-ink aria-selected:text-accent hover:bg-paper-2";
const OPTION_ACTIVE_CLASS = `${OPTION_CLASS} bg-paper-2`;

/** An option with a display label distinct from its committed value. */
export interface ComboboxItem {
  value: string;
  label: string;
}

/** A group of options, set off from its neighbours by a divider and an optional heading. */
export interface ComboboxGroup {
  /** Heading rendered above the group's options; omit for a bare, divider-only group. */
  label?: string;
  options: readonly (string | ComboboxItem)[];
}

// Normalise an options entry to {value,label}: a bare string is its own label
// and value.
const toItems = (options: readonly (string | ComboboxItem)[]): ComboboxItem[] =>
  options.map((option) => (typeof option === "string" ? { value: option, label: option } : option));

// The two `options` shapes never mix, so the first entry settles which one
// this is; an empty list normalises to no groups either way.
const toGroups = (
  options: readonly (string | ComboboxItem)[] | readonly ComboboxGroup[],
): { label?: string; items: ComboboxItem[] }[] => {
  const first = options[0];
  if (first === undefined) return [];
  if (typeof first === "object" && "options" in first) {
    return (options as readonly ComboboxGroup[]).map((group) => ({
      label: group.label,
      items: toItems(group.options),
    }));
  }
  return [{ items: toItems(options as readonly (string | ComboboxItem)[]) }];
};

/**
 * Searchable single-select — a combobox over a long list of values. The input
 * filters the options as you type (case-insensitive substring); ↑/↓ move the
 * highlight, Enter or a click commits the highlighted option, and Escape or a
 * click outside closes without changing the value. Driven by `value` /
 * `onChange`, which receives the chosen option's value; `options` is the full
 * set of selectable entries — a bare `string` (its own label and value) or a
 * `{ value, label }` pair when the display label differs from the committed
 * value. To section the list, pass `{ label?, options }` groups instead: each
 * group is set off by a divider (and its heading, when given), a filter that
 * empties a group hides it, and keyboard movement walks the flattened list.
 * Pass a `label` to render the field
 * lockup (label, optional `description` help line, `required` marker), wired for
 * assistive tech through the ARIA combobox/listbox roles; omit it for the
 * bare control. The list opens below the input, flipping above it when the
 * viewport leaves too little room underneath (a control docked near the
 * viewport foot). Reach for it over `Select` when the list is long enough
 * that scanning a native dropdown is painful. It carries no width or margin —
 * the field owns layout.
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
  options: readonly (string | ComboboxItem)[] | readonly ComboboxGroup[];
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

  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const groups = toGroups(options);
  const items: ComboboxItem[] = groups.flatMap((group) => group.items);
  // The committed value's label for the closed input; falls back to the raw
  // value when it isn't among the options (e.g. a pinned but now-absent entry).
  const selectedLabel = items.find((item) => item.value === value)?.label ?? value;

  // Open, the input shows the live filter and the list narrows to matches —
  // a group the filter empties disappears, heading and all; closed, it shows
  // the committed value and the full set stands by.
  const matches = (item: ComboboxItem) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase());
  const filteredGroups = open
    ? groups
        .map((group) => ({ ...group, items: group.items.filter(matches) }))
        .filter((group) => group.items.length > 0)
    : groups;
  // Keyboard movement and Enter work on the flattened list; rendering walks
  // the groups with a running offset so option ids line up with it.
  const filtered = filteredGroups.flatMap((group) => group.items);
  // Each group's start position in the flattened list, for rendering.
  const groupStarts: number[] = [];
  let flatCount = 0;
  for (const group of filteredGroups) {
    groupStarts.push(flatCount);
    flatCount += group.items.length;
  }
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

  // Pick the list's side as it opens, before paint: below by default, above
  // only when the viewport leaves less room under the input than the list
  // needs and there is more room over it. Settled once per open — a list
  // that shrinks as the filter narrows stays put rather than hopping sides.
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    const rect = root.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setOpenUp(below < list.offsetHeight + 8 && rect.top > below);
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

  // The popup sits below the input, or above it when that's the side with room.
  const listboxClass = `${LISTBOX_CLASS} ${openUp ? "bottom-full mb-1" : "mt-1"}`;

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
        data-1p-ignore
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
        <ul ref={listRef} id={listboxId} role="listbox" className={listboxClass}>
          {filtered.length === 0 ? (
            <li role="presentation" className="px-3 py-2 font-mono text-sm text-ink-faint italic">
              No matches
            </li>
          ) : (
            filteredGroups.map((group, groupIndex) => (
              // Groups are positional, so the index is the identity; option
              // keys are flat positions, since the same value may legitimately
              // appear in more than one group.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <Fragment key={groupIndex}>
                {groupIndex > 0 ? (
                  <li role="presentation" className="my-1 border-rule border-t" />
                ) : null}
                {group.label !== undefined ? (
                  <li
                    role="presentation"
                    className="px-3 pt-2 pb-1 font-mono text-ink-faint text-xs uppercase tracking-widest"
                  >
                    {group.label}
                  </li>
                ) : null}
                {group.items.map((item, itemIndex) => {
                  const index = groupStarts[groupIndex] + itemIndex;
                  return (
                    <ComboboxOption
                      key={index}
                      id={`${listboxId}-option-${index}`}
                      label={item.label}
                      selected={item.value === value}
                      active={index === active}
                      onSelect={() => commit(item)}
                    />
                  );
                })}
              </Fragment>
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
