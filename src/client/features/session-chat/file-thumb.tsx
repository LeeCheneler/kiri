import { useState } from "react";
import { Modal } from "../../design-system/surfaces/modal.tsx";

// Share the image thumbnail's footprint so attachments form one even row. The
// skeleton lines stand in for the document's text — there's nothing to render at
// thumbnail scale — with the filename beneath.
const THUMB_CLASS =
  "flex h-16 w-16 flex-col justify-between gap-1.5 overflow-hidden rounded-sm border border-rule bg-canvas p-2";

/**
 * A fixed-size tile standing in for an attached text file: skeleton lines over
 * the filename, sized like an image thumbnail. Shared by the composer's staged
 * attachments and the transcript so a file looks the same before and after send.
 */
export function FileThumb({ filename }: { filename: string }) {
  return (
    <div className={THUMB_CLASS} title={filename}>
      <div className="space-y-1" aria-hidden="true">
        <div className="h-1 w-full rounded-full bg-rule" />
        <div className="h-1 w-3/4 rounded-full bg-rule" />
        <div className="h-1 w-full rounded-full bg-rule" />
        <div className="h-1 w-2/3 rounded-full bg-rule" />
      </div>
      <span className="truncate font-mono text-[10px] text-ink-muted leading-none">{filename}</span>
    </div>
  );
}

/**
 * A sent text file in the transcript: a thumbnail that opens the full file
 * contents in a modal on click, mirroring an image attachment's preview.
 */
export function PreviewableFile({ filename, content }: { filename: string; content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`View ${filename}`}
        className="cursor-pointer outline-none focus-visible:outline-1 focus-visible:outline-accent"
      >
        <FileThumb filename={filename} />
      </button>
      {open ? (
        <Modal title={filename} onClose={() => setOpen(false)} size="lg">
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap font-mono text-ink text-sm">
            {content}
          </pre>
        </Modal>
      ) : null}
    </>
  );
}
