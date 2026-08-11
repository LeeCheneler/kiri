import { useEffect, useRef, useState } from "react";

/**
 * A framed screenshot of the running app — the site's way of showing the real
 * product rather than an illustration of it. Same window chrome as
 * `CodeWindow` so artifacts and screenshots read as one family; the image is
 * statically sized by its intrinsic dimensions to avoid layout shift.
 * Clicking the screenshot opens it at full size in a lightbox.
 */
export function AppWindow({
  src,
  alt,
  title,
  width,
  height,
}: {
  src: string;
  alt: string;
  title: string;
  width: number;
  height: number;
}) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <>
      <figure className="overflow-hidden rounded-sm border border-rule">
        <figcaption className="flex items-center border-rule border-b bg-paper-2 px-4 py-2.5">
          <span className="font-mono text-xs text-ink-faint tracking-wide">{title}</span>
        </figcaption>
        <button
          type="button"
          aria-label={`View full size: ${title}`}
          onClick={() => setZoomed(true)}
          className="block w-full cursor-zoom-in"
        >
          <img src={src} alt={alt} width={width} height={height} className="block h-auto w-full" />
        </button>
      </figure>
      {zoomed && (
        <Lightbox
          src={src}
          alt={alt}
          title={title}
          width={width}
          height={height}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
}

// Full-size screenshot viewer on the native `<dialog>` element, mounted-as-open
// like the app's `Modal`: the browser supplies the inert background, focus
// trap, Escape-fires-cancel, and focus-restore to the trigger. The image
// renders at its intrinsic size and the dialog scrolls, so detail is 1:1.
function Lightbox({
  src,
  alt,
  title,
  width,
  height,
  onClose,
}: {
  src: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // `close()` before unmount so focus returns to the trigger.
  const close = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is the dialog's native `cancel` event (Escape), routed through onCancel below; the click handler adds click-anywhere dismissal.
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      // A lightbox dismisses on any click — backdrop or image alike.
      onClick={close}
      className="m-auto max-h-[94vh] max-w-[96vw] overflow-auto border border-rule bg-paper shadow-xl backdrop:bg-canvas/80"
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className="block max-w-none cursor-zoom-out"
      />
    </dialog>
  );
}
