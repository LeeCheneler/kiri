import type { FileUIPart } from "ai";
import { useState } from "react";
import { Modal } from "../../design-system/surfaces/modal.tsx";

const THUMB_CLASS = "h-24 w-24 border border-rule object-cover";

/**
 * A fixed-size image thumbnail, shared by the composer's staged attachments and
 * the transcript so a pasted image looks the same before and after it is sent.
 */
export function ImageThumb({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className={THUMB_CLASS} />;
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
          <img src={part.url} alt={alt} className="mx-auto max-h-[70vh] w-auto" />
        </Modal>
      ) : null}
    </>
  );
}
