/**
 * Strip a small subset of inline markdown so a heading line can be
 * rendered as plain text. Handles the common cases that show up in
 * generated articles: links, images, inline code, bold, italic.
 *
 * Not a full markdown parser — escapes, reference links, autolinks,
 * and HTML pass through unchanged. The byline surfaces wrap the
 * heading in a `<Link>`, so leaving any of these as-is is preferable
 * to producing nested anchors.
 */
const stripInlineMarkdown = (text: string): string => {
  let out = text;
  // Images first — `![alt](url)` would otherwise match the link rule
  // and lose the leading `!`.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: `[text](url)` → `text`.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Inline code: `` `text` `` → `text`. Single backticks only; pairs
  // longer than one backtick are uncommon in headings.
  out = out.replace(/`([^`]+)`/g, "$1");
  // Bold before italic so `***text***` collapses cleanly (bold strips
  // the outer pair, italic strips the remaining one).
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/_([^_]+)_/g, "$1");
  return out;
};

/**
 * Extract the first ATX-style `# ` heading from a markdown string and
 * return it as plain display text — the leading hashes, any trailing
 * closing hashes, and common inline markdown (links, images, code,
 * emphasis) are stripped so the result can be dropped into a text node.
 * Returns `null` when no heading is present.
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
    if (match) return stripInlineMarkdown(match[1]).trim();
  }
  return null;
};
