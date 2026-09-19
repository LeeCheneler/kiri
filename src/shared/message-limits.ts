import { parseAttachedFile } from "./attached-file.ts";

/** Maximum raw size of one image, in MiB. */
export const MAX_IMAGE_MB = 10;
/** Maximum raw size of one image, in bytes. */
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
/** Maximum raw size of one document, in MiB. */
export const MAX_DOCUMENT_MB = 20;
/** Maximum raw size of one document, in bytes. */
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MB * 1024 * 1024;
/** Maximum UTF-8 size of one text attachment, in KiB. */
export const MAX_TEXT_FILE_KB = 256;
/** Maximum UTF-8 size of one text attachment, in bytes. */
export const MAX_TEXT_FILE_BYTES = MAX_TEXT_FILE_KB * 1024;
/** Default API request limit, including queued text messages. */
export const API_BODY_LIMIT_BYTES = 256 * 1024;
/** Maximum encoded session-turn request size, including JSON and base64. */
export const MESSAGE_BODY_LIMIT_BYTES = 32 * 1024 * 1024;
/** Reserve envelope space for message ids and fields added by the transport. */
export const MESSAGE_PARTS_LIMIT_BYTES = MESSAGE_BODY_LIMIT_BYTES - 1024;
/** Actionable error shared by message validation and HTTP body middleware. */
export const MESSAGE_SIZE_ERROR =
  "Messages must fit within 32 MiB including encoded attachments. Remove an attachment or shorten the message.";

/** Measure JSON as UTF-8 bytes, including escaping and structural overhead. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Check user-message attachment and encoded-parts limits before any mutation.
 * Other part validation belongs to the request schema, not this size policy.
 */
export function messagePartsError(parts: readonly unknown[]): string | undefined {
  if (jsonBytes(parts) > MESSAGE_PARTS_LIMIT_BYTES) return MESSAGE_SIZE_ERROR;
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue;
    if ("type" in part && part.type === "text" && "text" in part && typeof part.text === "string") {
      const file = parseAttachedFile(part.text);
      if (file && new TextEncoder().encode(file.content).byteLength > MAX_TEXT_FILE_BYTES) {
        return `Text files must be ${MAX_TEXT_FILE_KB} KiB or smaller.`;
      }
    }
    if (
      !("type" in part) ||
      part.type !== "file" ||
      !("url" in part) ||
      typeof part.url !== "string" ||
      !("mediaType" in part) ||
      typeof part.mediaType !== "string"
    )
      continue;
    // Uploaded files are inline data URLs. Count decoded bytes without allocating
    // another copy of the binary; malformed encodings cannot bypass the cap.
    const comma = part.url.indexOf(",");
    if (!part.url.startsWith("data:") || !part.url.slice(0, comma).endsWith(";base64")) {
      return "Attachments must use base64 data URLs.";
    }
    const data = part.url.slice(comma + 1);
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    if (
      data.length % 4 === 1 ||
      (padding > 0 && data.length % 4 !== 0) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    ) {
      return "Attachment data is not valid base64.";
    }
    const bytes = Math.floor((data.length / 4) * 3) - padding;
    const image = part.mediaType.startsWith("image/");
    if (bytes > (image ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES)) {
      return image
        ? `Images must be ${MAX_IMAGE_MB} MiB or smaller.`
        : `Documents must be ${MAX_DOCUMENT_MB} MiB or smaller.`;
    }
  }
}
