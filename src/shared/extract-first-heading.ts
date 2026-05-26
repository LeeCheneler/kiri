/**
 * Extract the first ATX-style `# ` heading from a markdown string. Returns
 * the heading's text (trimmed, with the leading hashes and any trailing
 * closing hashes stripped) or `null` when no heading is present.
 *
 * Skips lines inside fenced code blocks (``` or ~~~) so a `# foo` inside
 * a code sample isn't mistaken for a heading. Only `#` headings (h1) are
 * recognised — sub-headings and Setext underline syntax are ignored, which
 * matches the rail's intent of surfacing the article's top-level subject.
 *
 * Pure and dependency-free so both the server (article projection) and the
 * client can import without pulling a markdown parser.
 */
export const extractFirstHeading = (md: string): string | null => {
  const lines = md.split("\n");
  let fence: string | null = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```")) {
      fence = "```";
      continue;
    }
    if (trimmed.startsWith("~~~")) {
      fence = "~~~";
      continue;
    }
    const match = /^#\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (match) return match[1].trim();
  }
  return null;
};
