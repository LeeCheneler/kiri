import type { FileUIPart } from "ai";
import { useState } from "react";
import { Modal } from "../../design-system/surfaces/modal.tsx";

const THUMB_CLASS = "h-16 w-16 rounded-sm border border-rule object-cover";

/**
 * A fixed-size image thumbnail, shared by the composer's staged attachments and
 * the transcript so a pasted image looks the same before and after it is sent.
 */
export function ImageThumb({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className={THUMB_CLASS} />;
}

/**
 * A generated image in the transcript: rendered at up to the container's full
 * width, opening the full-resolution image in a modal preview on click.
 */
export function FullWidthImage({ part }: { part: FileUIPart }) {
  const [open, setOpen] = useState(false);
  const alt = part.filename ?? "Image";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View full size"
        className="block cursor-pointer outline-none focus-visible:outline-1 focus-visible:outline-accent"
      >
        <img src={part.url} alt={alt} className="max-w-full rounded-sm border border-rule" />
      </button>
      {open ? (
        <Modal title={alt} onClose={() => setOpen(false)}>
          <img src={part.url} alt={alt} className="mx-auto max-h-[70vh] w-auto rounded-sm" />
        </Modal>
      ) : null}
    </>
  );
}

/**
 * A sent image in the transcript: a thumbnail that opens the full image in a
 * modal preview on click.
 */
export function PreviewableImage({ part }: { part: FileUIPart }) {
  const [open, setOpen] = useState(false);
  const alt = part.filename ?? "Attached image";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="View full size"
        className="cursor-pointer outline-none focus-visible:outline-1 focus-visible:outline-accent"
      >
        <ImageThumb src={part.url} alt={alt} />
      </button>
      {open ? (
        <Modal title={part.filename ?? "Image"} onClose={() => setOpen(false)}>
          <img src={part.url} alt={alt} className="mx-auto max-h-[70vh] w-auto rounded-sm" />
        </Modal>
      ) : null}
    </>
  );
}
