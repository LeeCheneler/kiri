import type { FileUIPart } from "ai";
import { DOCUMENT_TYPES } from "../../../shared/document-types.ts";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_MB,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_FILE_KB,
} from "../../../shared/message-limits.ts";

// Pasted/uploaded images ride the message as data-URL file parts, so they are
// stored and replayed with the transcript without a separate upload channel.
// Cap the size so a stray large paste doesn't bloat the request or the stored
// message — the model input limit bites long before anything generous would.

/** A staged image in the composer, before it is sent as a message part. */
export type PendingImage = { id: string; part: FileUIPart };

/** The image files in a clipboard / file-input list; non-images are ignored. */
export function imageFilesFrom(files: FileList | null | undefined): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

// Encode the file as a base64 data URL from its bytes. The image rides inline
// in the message part, so there's no separate upload channel. Reading the byte
// buffer (rather than FileReader's callback pair) keeps this a single path; a
// read failure just rejects and bubbles.
async function fileToDataUrl(file: File, mediaType: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

export type PendingImagesResult = { images: PendingImage[]; error?: string };

/**
 * Read image files into pending attachments (data-URL file parts). Files over
 * the size cap are skipped and reported via `error`, so an over-large paste
 * surfaces a reason rather than silently vanishing.
 */
export async function readPendingImages(files: File[]): Promise<PendingImagesResult> {
  const images: PendingImage[] = [];
  let error: string | undefined;
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      error = `Images must be ${MAX_IMAGE_MB} MiB or smaller.`;
      continue;
    }
    const url = await fileToDataUrl(file, file.type);
    images.push({
      id: crypto.randomUUID(),
      part: { type: "file", mediaType: file.type, filename: file.name, url },
    });
  }
  return { images, error };
}

// Text files are attached by value: their contents ride inline in the message as
// a wrapped text part (see `wrapAttachedFile`), so they reach every provider as
// plain text — no per-provider file-part mapping and no separate upload channel.
// Cap the size so a stray large file doesn't blow the model's context window;
// text is far denser in tokens than an image of the same byte size.

// Attachable text is detected by file extension, not MIME type: browsers report
// an empty type for many text files (e.g. `.md`), so the extension is the only
// reliable signal.
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
export function attachmentAccept({
  images,
  documents,
}: {
  images: boolean;
  documents: readonly string[];
}): string {
  return [
    ...(images ? ["image/*"] : []),
    ...DOCUMENT_TYPES.filter((type) => documents.includes(type.mediaType)).map(
      (type) => type.extension,
    ),
    ...TEXT_FILE_EXTENSIONS,
  ].join(",");
}

/** A staged text file in the composer, before it is sent as a wrapped text part. */
export type PendingTextFile = { id: string; filename: string; content: string };

/** The attachable text files in a clipboard / file-input list; others are ignored. */
export function textFilesFrom(files: FileList | null | undefined): File[] {
  if (!files) return [];
  return Array.from(files).filter((file) => TEXT_FILE_EXTENSIONS.has(extensionOf(file.name)));
}

export type PendingTextFilesResult = { textFiles: PendingTextFile[]; error?: string };

/**
 * Read text files into pending attachments (filename + contents). Files over the
 * size cap are skipped and reported via `error`, so an over-large file surfaces a
 * reason rather than silently vanishing.
 */
export async function readPendingTextFiles(files: File[]): Promise<PendingTextFilesResult> {
  const textFiles: PendingTextFile[] = [];
  let error: string | undefined;
  for (const file of files) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      error = `Text files must be ${MAX_TEXT_FILE_KB} KiB or smaller.`;
      continue;
    }
    textFiles.push({ id: crypto.randomUUID(), filename: file.name, content: await file.text() });
  }
  return { textFiles, error };
}

// Documents — PDFs and Office files — ride like images: binary file parts
// carrying a data URL, stored and replayed with the transcript. Unlike text
// files they only reach a model whose provider transport maps the part, so
// which types are attachable comes from the session's model (its
// `documentInput`). Detected by extension like text files, because browsers
// report an empty or generic type for many Office files.

/** A staged document in the composer, before it is sent as a message part. */
export type PendingDocument = { id: string; part: FileUIPart };

/** A picked document file with the media type its extension maps to. */
export type DocumentFile = { file: File; mediaType: string };

/** The document files in a file-input list, with their media types; others are ignored. */
export function documentFilesFrom(files: FileList | null | undefined): DocumentFile[] {
  if (!files) return [];
  return Array.from(files).flatMap((file) => {
    const type = DOCUMENT_TYPES.find((type) => type.extension === extensionOf(file.name));
    return type ? [{ file, mediaType: type.mediaType }] : [];
  });
}

export type PendingDocumentsResult = { documents: PendingDocument[]; error?: string };

/**
 * Read document files into pending attachments (data-URL file parts). A file of
 * a type the model doesn't accept, or one over the size cap, is skipped and
 * reported via `error` — the picker's `accept` narrows the dialog, but a real
 * picker can still hand over anything via "All Files".
 */
export async function readPendingDocuments(
  files: DocumentFile[],
  accepted: readonly string[],
): Promise<PendingDocumentsResult> {
  const documents: PendingDocument[] = [];
  let error: string | undefined;
  for (const { file, mediaType } of files) {
    if (!accepted.includes(mediaType)) {
      error = `This model can't read ${extensionOf(file.name)} files. Switch model to attach it.`;
      continue;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      error = `Documents must be ${MAX_DOCUMENT_MB} MiB or smaller.`;
      continue;
    }
    const url = await fileToDataUrl(file, mediaType);
    documents.push({
      id: crypto.randomUUID(),
      part: { type: "file", mediaType, filename: file.name, url },
    });
  }
  return { documents, error };
}
