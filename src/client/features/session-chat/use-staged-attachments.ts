import { useState } from "react";
import {
  type AttachmentCapabilities,
  type PickedFile,
  type ReadAttachment,
  type StagedAttachment,
  readAttachment,
  screenPickedFiles,
  unreadableAttachmentErrors,
} from "./attachments.ts";

const STILL_READING = "Attachments are still being read. Send again in a moment.";

const isRead = (attachment: StagedAttachment): attachment is ReadAttachment =>
  attachment.kind !== "reading";

/**
 * The composer's staged attachments: one list in staging order, and the errors
 * from the latest attempt to add to or send it. Each batch of picked files is
 * screened against the model's `capabilities` and the size caps in one pass, so
 * every refusal in it is reported together. Accepted files are staged at once
 * as `reading` and filled in as their contents arrive. The capabilities are
 * checked again on sending, since the model can change under a staged draft.
 */
export function useStagedAttachments(
  initial: StagedAttachment[],
  capabilities: AttachmentCapabilities,
) {
  const [attachments, setAttachments] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);

  const addFiles = async (files: PickedFile[]) => {
    if (files.length === 0) return;
    const screened = screenPickedFiles(files, capabilities);
    setErrors(screened.errors);
    const reading = screened.accepted.map((picked) => ({ id: crypto.randomUUID(), picked }));
    setAttachments((prev) => [
      ...prev,
      ...reading.map(({ id, picked }) => ({
        id,
        kind: "reading" as const,
        filename: picked.file.name,
      })),
    ]);
    for (const { id, picked } of reading) {
      try {
        const read = await readAttachment(id, picked);
        // Fills the file's place in the list. One removed while it was being
        // read has no place left, so its late contents are dropped.
        setAttachments((prev) =>
          prev.map((attachment) => (attachment.id === id ? read : attachment)),
        );
      } catch {
        // An unreadable file would otherwise hold up sending for good.
        setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
        setErrors((prev) => [...prev, `Couldn't read ${picked.file.name}.`]);
      }
    }
    setErrors((prev) => prev.filter((error) => error !== STILL_READING));
  };

  const remove = (id: string) =>
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));

  /**
   * The staged attachments, when they can be sent — or `undefined`, with the
   * reason shown. Sending while one is still being read would leave it behind,
   * and one the current model can't read would only fail the turn.
   */
  const takeSendable = (): ReadAttachment[] | undefined => {
    const read = attachments.filter(isRead);
    const blockers =
      read.length < attachments.length
        ? [STILL_READING]
        : unreadableAttachmentErrors(read, capabilities);
    if (blockers.length === 0) return read;
    setErrors(blockers);
  };

  const clear = () => {
    setAttachments([]);
    setErrors([]);
  };

  return { attachments, errors, addFiles, remove, takeSendable, clear, setErrors };
}
