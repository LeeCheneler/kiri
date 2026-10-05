import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../actions/button.tsx";

/**
 * Off-canvas drawer built on the native `<dialog>` element, anchored to the
 * left edge by default (`side="right"` for a right panel) and full-height.
 * Includes a visible Close action. Like `Modal`, it is open while mounted — render
 * it to open it, and let `onClose` tell the parent to unmount; the browser
 * supplies the inert background, focus trap, Escape handling, and focus-restore
 * to the trigger. `title` becomes the drawer heading and its accessible label;
 * the body is the children, which fill the column beneath the title and scroll
 * when they overflow. It owns the panel, the slide-in, and its padding —
 * nothing outside it. Reach for it over `Modal` when the surface is navigation
 * or a side panel rather than a centred, focused decision.
 */
export function Drawer({
  title,
  onClose,
  children,
  side = "left",
}: {
  side?: "left" | "right";
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  // Open as a true modal: background inert, focus trapped, Escape fires the
  // dialog's `cancel` event, and focus returns to the trigger when it closes.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Responsive triggers can become hidden while the drawer is open. Keep the
  // modal outside those ancestors so resizing cannot hide a focus-trapping panel.
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is the dialog's native `cancel` event (Escape), routed through onCancel below; the click handler only adds backdrop dismissal.
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      // Escape fires the dialog's `cancel` event: stop the default close so we
      // drive it ourselves — `close()` restores focus to the trigger (removing
      // the element on unmount would not), then the parent unmounts.
      onCancel={(event) => {
        event.preventDefault();
        dialogRef.current?.close();
        onClose();
      }}
      // A click dismisses only when its target is the dialog element itself —
      // the backdrop. Padding lives on the inner wrapper, so clicks anywhere in
      // the visible panel land on a child and never read as a backdrop click.
      // `close()` first so focus returns to the trigger, then the parent unmounts.
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
          onClose();
        }
      }}
      data-side={side}
      className={`m-0 h-dvh max-h-dvh max-w-[85vw] border-rule bg-paper text-left text-ink shadow-xl backdrop:bg-canvas/80 ${side === "right" ? "left-auto right-0 w-96 animate-[drawer-right-in_220ms_ease-out] border-l" : "w-72 animate-[drawer-in_220ms_ease-out] border-r"}`}
    >
      <div className="flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="font-display text-2xl text-ink leading-tight">
            {title}
          </h2>
          <Button
            variant="dismissive"
            onClick={() => {
              dialogRef.current?.close();
              onClose();
            }}
          >
            Close
          </Button>
        </div>
        <div className="mt-6 flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
