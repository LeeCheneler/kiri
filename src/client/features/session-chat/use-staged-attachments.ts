import { useState } from "react";
import {
  type AttachmentCapabilities,
  type PickedFile,
  type ReadAttachment,
  type StagedAttachment,
  readAttachment,
  screenPickedFiles,
} from "./attachments.ts";

const STILL_READING = "Attachments are still being read. Send again in a moment.";

const isRead = (attachment: StagedAttachment): attachment is ReadAttachment =>
  attachment.kind !== "reading";

/**
 * The composer's staged attachments: one list in staging order, and the errors
 * from the latest attempt to add to or send it. Each batch of picked files is
 * screened against the model's `capabilities` and the size caps in one pass, so
 * every refusal in it is reported together. Accepted files are staged at once
 * as `reading` and filled in as their contents arrive.
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
   * The staged attachments, once every one has been read — or `undefined`,
   * with the reason shown, while any is still being read: sending now would
   * leave it behind.
   */
  const takeRead = (): ReadAttachment[] | undefined => {
    const read = attachments.filter(isRead);
    if (read.length === attachments.length) return read;
    setErrors([STILL_READING]);
  };

  const clear = () => {
    setAttachments([]);
    setErrors([]);
  };

  return { attachments, errors, addFiles, remove, takeRead, clear, setErrors };
}
