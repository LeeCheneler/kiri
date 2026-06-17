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

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
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
    const url = await readDataUrl(file);
    images.push({
      id: crypto.randomUUID(),
      part: { type: "file", mediaType: file.type, filename: file.name, url },
    });
  }
  return { images, error };
}
