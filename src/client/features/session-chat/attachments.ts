import type { FileUIPart } from "ai";

// Pasted/uploaded images ride the message as data-URL file parts, so they are
// stored and replayed with the transcript without a separate upload channel.
// Cap the size so a stray large paste doesn't bloat the request or the stored
// message — the model input limit bites long before anything generous would.
export const MAX_IMAGE_MB = 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

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
async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
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
      error = `Images must be under ${MAX_IMAGE_MB} MB.`;
      continue;
    }
    const url = await fileToDataUrl(file);
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
export const MAX_TEXT_FILE_KB = 256;
const MAX_TEXT_FILE_BYTES = MAX_TEXT_FILE_KB * 1024;

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
      error = `Text files must be under ${MAX_TEXT_FILE_KB} KB.`;
      continue;
    }
    textFiles.push({ id: crypto.randomUUID(), filename: file.name, content: await file.text() });
  }
  return { textFiles, error };
}

const ATTACHED_FILE_RE = /^<attached-file name="([^"]*)">\n([\s\S]*)\n<\/attached-file>$/;

/**
 * Wrap a text file's contents as an `<attached-file>` text part: a delimiter that
 * marks it as quoted, untrusted file content and lets the transcript render it
 * back as a chip. Quotes in the name are normalised so it round-trips through
 * `parseAttachedFile`.
 */
export function wrapAttachedFile(filename: string, content: string): string {
  return `<attached-file name="${filename.replace(/"/g, "'")}">\n${content}\n</attached-file>`;
}

/**
 * Parse an `<attached-file>` text part back into its filename and contents, or
 * null when the text isn't a wrapped attachment (i.e. ordinary typed text).
 */
export function parseAttachedFile(text: string): { filename: string; content: string } | null {
  const match = ATTACHED_FILE_RE.exec(text);
  return match ? { filename: match[1], content: match[2] } : null;
}
