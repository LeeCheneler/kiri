import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../actions/button.tsx";

/**
 * A trigger button owning a small floating panel — for a cluster of controls
 * that's reached for occasionally and shouldn't occupy the surface it serves.
 * `trigger` names the button (rendered as the standard `Button`); `label`
 * names the panel for assistive tech (it carries the `dialog` role, non-modal:
 * the page behind stays live). The panel opens under the trigger, flipping
 * above it when the viewport leaves too little room underneath (a trigger
 * docked near the viewport foot); `align` pins it to the trigger's `"start"`
 * (default) or `"end"` edge. Escape and a click outside dismiss it; Escape
 * also hands focus back to the trigger, and never leaks past the popover (so
 * a page-level Escape handler doesn't fire from inside it). The panel owns
 * frame and padding only — the content dictates its size.
 */
export function Popover({
  trigger,
  label,
  align = "start",
  children,
}: {
  trigger: string;
  label: string;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);

  // Pick the panel's side as it opens, before paint: below the trigger by
  // default, above it only when the viewport leaves less room underneath than
  // the panel needs and there is more room over it.
  useLayoutEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    const rect = root.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setOpenUp(below < panel.offsetHeight + 8 && rect.top > below);
  }, [open]);

  // A pointer-down anywhere outside dismisses the open panel — the same as
  // Escape, minus the focus return (the pointer has somewhere else to be).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    // The trigger is the root's first button in document order — the panel
    // (and any buttons inside it) renders after it.
    rootRef.current?.querySelector("button")?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Never leak Escape past the popover; but when a control inside
        // already spent it (a combobox closing its own list preventDefaults),
        // the panel stays up — one Escape, one dismissal.
        event.stopPropagation();
        if (!event.defaultPrevented) close();
      }}
    >
      <Button aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        {trigger}
      </Button>
      {open ? (
        // A native non-modal dialog, shown via the `open` attribute: the
        // dialog role comes free and the page behind stays live — no
        // showModal(), so no inert background or focus trap.
        <dialog
          ref={panelRef}
          open
          aria-label={label}
          className={`absolute z-20 m-0 border border-rule bg-paper p-4 text-ink shadow-lg ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "end" ? "right-0 left-auto" : "left-0"}`}
        >
          {children}
        </dialog>
      ) : null}
    </div>
  );
}
