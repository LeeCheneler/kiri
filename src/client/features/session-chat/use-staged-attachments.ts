import { useState } from "react";
import {
  type AttachmentCapabilities,
  type PickedFile,
  type StagedAttachment,
  readAttachment,
  screenPickedFiles,
} from "./attachments.ts";

/**
 * The composer's staged attachments: one list in staging order, and the errors
 * from the latest attempt to add to or send it. Each batch of picked files is
 * screened against the model's `capabilities` and the size caps in one pass, so
 * every refusal in it is reported together.
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
    const read: StagedAttachment[] = [];
    for (const picked of screened.accepted) read.push(await readAttachment(picked));
    if (read.length > 0) setAttachments((prev) => [...prev, ...read]);
  };

  const remove = (id: string) =>
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));

  const clear = () => {
    setAttachments([]);
    setErrors([]);
  };

  return { attachments, errors, addFiles, remove, clear, setErrors };
}
