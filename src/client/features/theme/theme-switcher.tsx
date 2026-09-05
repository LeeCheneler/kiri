import { useEffect, useId, useRef, useState } from "react";
import { THEMES, type ThemeId, currentTheme, setTheme } from "./theme.ts";

/**
 * Rail control for the UI theme: a round button that opens a panel of
 * swatches, one per theme, out to its right. Each swatch is stamped with its
 * own `data-theme`, so it renders in the theme it offers — the panel is its
 * own preview. Choosing one applies it to the document immediately and
 * persists it (see `theme.ts`). The panel is a non-modal dialog dismissed by
 * Escape (which hands focus back to the button) or a click outside, as the
 * design-system Popover does; it sizes to its content rather than the rail.
 */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState<ThemeId>(currentTheme);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groupName = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const choose = (id: ThemeId) => {
    setTheme(id);
    setThemeState(id);
  };

  return (
    <div
      ref={rootRef}
      className="relative w-fit"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Theme"
        title="Theme"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-rule bg-paper text-accent outline-none transition-colors duration-150 hover:border-accent focus-visible:border-accent"
      >
        {/* A half-filled disc in the current theme's accent, so the button
            itself shows the palette it opens. */}
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.75A6.25 6.25 0 0 1 8 14.25Z" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        // Bottom-aligned with the button and opening rightward. The dialog's
        // user-agent style pins `right: 0` too, so it is reset explicitly.
        <dialog
          open
          aria-label="Theme"
          className="absolute bottom-0 left-full m-0 ml-3 w-max border border-rule bg-paper p-3 text-ink shadow-lg right-auto z-20"
        >
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
            {THEMES.map((option) => {
              const selected = option.id === theme;
              return (
                <label
                  key={option.id}
                  data-theme={option.id}
                  className={`flex w-36 cursor-pointer flex-col gap-2 border bg-canvas p-3 transition-colors duration-150 has-[:focus-visible]:outline-1 has-[:focus-visible]:-outline-offset-1 has-[:focus-visible]:outline-accent ${
                    selected ? "border-accent" : "border-rule hover:border-ink-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={option.id}
                    checked={selected}
                    onChange={() => choose(option.id)}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full border border-rule bg-paper-2" />
                    <span className="h-3 w-3 rounded-full bg-accent" />
                    <span className="h-3 w-3 rounded-full bg-status-running" />
                    <span className="h-3 w-3 rounded-full bg-status-ok" />
                  </span>
                  <span className="font-display text-sm text-ink">{option.name}</span>
                  <span className="font-mono text-[11px] text-ink-muted">{option.tagline}</span>
                </label>
              );
            })}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
