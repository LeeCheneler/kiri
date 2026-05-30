import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Modal dialog built on the native `<dialog>` element. Open while it is
 * mounted — render it to open it, and let `onClose` tell the parent to
 * unmount; the browser then supplies the inert background, focus trap, Escape
 * handling, and focus-restore to the trigger. `title` becomes the dialog
 * heading and its accessible label; the body is the children, so callers
 * compose any footer actions themselves. It owns the dialog frame, the centred
 * overlay, and its padding — nothing outside it.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
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

  return (
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
      // the visible card land on a child and never read as a backdrop click.
      // `close()` first so focus returns to the trigger, then the parent unmounts.
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close();
          onClose();
        }
      }}
      // `m-auto` restores the centering Tailwind's preflight strips from the UA
      // dialog; `text-left` anchors content alignment against any inherited
      // text-align from the mount point. `overflow-x-hidden` clips the horizontal
      // axis the UA dialog leaves as `overflow: auto`: when the body fills the
      // dialog's content width exactly, the scale-in entrance tips that axis into
      // "scrollable" for a few sub-pixel frames and macOS flashes an overlay
      // scrollbar. Clipping x removes it; y stays scrollable for tall content.
      className="m-auto w-full max-w-md overflow-x-hidden animate-[modal-in_180ms_ease-out] border border-rule bg-paper text-left text-ink shadow-xl backdrop:bg-canvas/80"
    >
      <div className="p-6">
        <h2 id={headingId} className="font-display text-2xl text-ink leading-tight">
          {title}
        </h2>
        <div className="mt-6">{children}</div>
      </div>
    </dialog>
  );
}
