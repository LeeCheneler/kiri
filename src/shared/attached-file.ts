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
