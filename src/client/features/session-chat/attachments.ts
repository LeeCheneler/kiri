import type { FileUIPart, UIMessage } from "ai";
import { parseAttachedFile, wrapAttachedFile } from "../../../shared/attached-file.ts";
import { DOCUMENT_TYPES } from "../../../shared/document-types.ts";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_MB,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_FILE_KB,
} from "../../../shared/message-limits.ts";

// The composer stages three kinds of attachment in one list. Images and
// documents (PDFs, Office files) ride the message as data-URL file parts, so
// they are stored and replayed with the transcript without a separate upload
// channel — but a document only reaches a model whose provider transport maps
// the part, so which types are attachable comes from the session's model. Text
// files are attached by value: their contents ride inline as a wrapped text
// part (see `wrapAttachedFile`), so they reach every provider as plain text.

/** The kinds of attachment the composer stages. */
export type AttachmentKind = "image" | "document" | "text";

/** A staged attachment whose contents are in hand, ready to send as a message part. */
export type ReadAttachment =
  | { id: string; kind: "image"; part: FileUIPart }
  | { id: string; kind: "document"; part: FileUIPart }
  | { id: string; kind: "text"; filename: string; content: string };

/**
 * A staged attachment in the composer. A picked file holds its place in the
 * list as `reading` until its contents arrive, so staging order is pick order
 * however long each read takes.
 */
export type StagedAttachment = ReadAttachment | { id: string; kind: "reading"; filename: string };

/** What the session's model can be sent: images at all, and which document media types. */
export type AttachmentCapabilities = { images: boolean; documents: readonly string[] };

/** A picked or pasted file the composer can attach, with the kind it stages as. */
export type PickedFile =
  | { file: File; kind: "image" | "document"; mediaType: string }
  | { file: File; kind: "text" };

// Attachable text is detected by file extension, not MIME type: browsers report
// an empty type for many text files (e.g. `.md`), so the extension is the only
// reliable signal. Documents are detected the same way, because browsers report
// an empty or generic type for many Office files.
const TEXT_FILE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".html",
  ".css",
  ".xml",
  ".log",
  ".sh",
]);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/**
 * The composer file picker's `accept` value: text files always, images when
 * the model reads them, and each document type the model's provider carries.
 */
export function attachmentAccept({ images, documents }: AttachmentCapabilities): string {
  return [
    ...(images ? ["image/*"] : []),
    ...DOCUMENT_TYPES.filter((type) => documents.includes(type.mediaType)).map(
      (type) => type.extension,
    ),
    ...TEXT_FILE_EXTENSIONS,
  ].join(",");
}

/**
 * The attachable files in a clipboard / file-input list, in the order given,
 * each with the kind it stages as; anything else is ignored.
 */
export function pickedFilesFrom(files: FileList | null | undefined): PickedFile[] {
  if (!files) return [];
  return Array.from(files).flatMap((file): PickedFile[] => {
    if (file.type.startsWith("image/")) return [{ file, kind: "image", mediaType: file.type }];
    const extension = extensionOf(file.name);
    const document = DOCUMENT_TYPES.find((type) => type.extension === extension);
    if (document) return [{ file, kind: "document", mediaType: document.mediaType }];
    return TEXT_FILE_EXTENSIONS.has(extension) ? [{ file, kind: "text" }] : [];
  });
}

// Cap each kind's size so a stray large file doesn't bloat the request or the
// stored message. Text is far denser in tokens than binary of the same byte
// size, so its cap is much tighter.
const SIZE_CAPS: Record<AttachmentKind, { bytes: number; error: string }> = {
  image: { bytes: MAX_IMAGE_BYTES, error: `Images must be ${MAX_IMAGE_MB} MiB or smaller.` },
  document: {
    bytes: MAX_DOCUMENT_BYTES,
    error: `Documents must be ${MAX_DOCUMENT_MB} MiB or smaller.`,
  },
  text: {
    bytes: MAX_TEXT_FILE_BYTES,
    error: `Text files must be ${MAX_TEXT_FILE_KB} KiB or smaller.`,
  },
};

// Why the model can't be sent a binary attachment, if it can't. A document is
// named by its extension — or, for a media type outside the shared vocabulary,
// by the type itself.
function modelRefusal(
  kind: "image" | "document",
  mediaType: string,
  capabilities: AttachmentCapabilities,
): string | undefined {
  if (kind === "image") {
    return capabilities.images
      ? undefined
      : "This model reads text only. Switch model to attach images.";
  }
  if (capabilities.documents.includes(mediaType)) return;
  const extension = DOCUMENT_TYPES.find((type) => type.mediaType === mediaType)?.extension;
  return `This model can't read ${extension ?? mediaType} files. Switch model to attach it.`;
}

// Why a picked file can't be staged, if it can't: the model doesn't read its
// kind, or it is over its kind's size cap.
function refusal(picked: PickedFile, capabilities: AttachmentCapabilities): string | undefined {
  const unreadable =
    picked.kind === "text" ? undefined : modelRefusal(picked.kind, picked.mediaType, capabilities);
  if (unreadable) return unreadable;
  if (picked.file.size > SIZE_CAPS[picked.kind].bytes) return SIZE_CAPS[picked.kind].error;
}

/**
 * Split picked files into those that can be staged and the distinct reasons the
 * rest can't, so a refused file surfaces why rather than silently vanishing.
 * Needs no file contents — the picker's `accept` narrows the dialog, but a real
 * picker can still hand over anything via "All Files", and a paste bypasses it.
 */
export function screenPickedFiles(
  files: PickedFile[],
  capabilities: AttachmentCapabilities,
): { accepted: PickedFile[]; errors: string[] } {
  const accepted: PickedFile[] = [];
  const errors = new Set<string>();
  for (const picked of files) {
    const error = refusal(picked, capabilities);
    if (error) errors.add(error);
    else accepted.push(picked);
  }
  return { accepted, errors: [...errors] };
}

/**
 * The distinct reasons the model can't be sent these staged attachments — the
 * staging screen again, for a model switched (or a message sent) since.
 */
export function unreadableAttachmentErrors(
  attachments: readonly ReadAttachment[],
  capabilities: AttachmentCapabilities,
): string[] {
  const errors = attachments.flatMap((attachment) => {
    if (attachment.kind === "text") return [];
    return modelRefusal(attachment.kind, attachment.part.mediaType, capabilities) ?? [];
  });
  return [...new Set(errors)];
}

// Encode the file as a base64 data URL from its bytes. Reading the byte buffer
// (rather than FileReader's callback pair) keeps this a single path; a read
// failure just rejects and bubbles.
async function fileToDataUrl(file: File, mediaType: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

/**
 * Read a picked file into the attachment staged as `id`: a data-URL file part,
 * or a text file's contents.
 */
export async function readAttachment(id: string, picked: PickedFile): Promise<ReadAttachment> {
  const { file } = picked;
  if (picked.kind === "text") {
    return { id, kind: "text", filename: file.name, content: await file.text() };
  }
  const { kind, mediaType } = picked;
  const url = await fileToDataUrl(file, mediaType);
  return { id, kind, part: { type: "file", mediaType, filename: file.name, url } };
}

/** The name a staged attachment shows under; restored file parts may carry none. */
export function attachmentName(attachment: StagedAttachment): string {
  if (attachment.kind === "text" || attachment.kind === "reading") return attachment.filename;
  return (
    attachment.part.filename ??
    (attachment.kind === "image" ? "Attached image" : "Attached document")
  );
}

/**
 * The message parts staged attachments are sent as, in staging order. Text
 * files ride as `<attached-file>` text parts, which reach every provider as
 * plain text.
 */
export function attachmentParts(attachments: readonly ReadAttachment[]): UIMessage["parts"] {
  return attachments.map((attachment) =>
    attachment.kind === "text"
      ? { type: "text", text: wrapAttachedFile(attachment.filename, attachment.content) }
      : attachment.part,
  );
}

/** A sent message's attachments, restaged in the order they were sent — for editing it. */
export function stagedAttachmentsFrom(message: UIMessage): ReadAttachment[] {
  return message.parts.flatMap((part, index): ReadAttachment[] => {
    const id = `${message.id}-${index}`;
    if (part.type === "file") {
      return [{ id, kind: part.mediaType.startsWith("image/") ? "image" : "document", part }];
    }
    if (part.type !== "text") return [];
    const file = parseAttachedFile(part.text);
    return file ? [{ id, kind: "text", ...file }] : [];
  });
}
