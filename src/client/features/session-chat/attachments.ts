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
