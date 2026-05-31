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

/** An article's leading `# ` headline and the body that follows it. */
export interface SplitHeading {
  /** Headline as plain display text, or `null` when the article has none. */
  heading: string | null;
  /** Body after the headline; the full input unchanged when there is no headline. */
  body: string;
}

/**
 * Split a markdown article into its leading `# ` headline and the body that
 * follows. Anything before the headline — preamble an assistant may emit ahead
 * of the article ("Sure, here's the piece…") — is dropped along with the
 * headline line itself, and leading blank lines are trimmed, so `body` starts
 * at the content proper.
 *
 * `heading` is the headline as plain display text: the leading hashes, any
 * trailing closing hashes, and common inline markdown (links, images, code,
 * emphasis) are stripped so it can be dropped into a text node. It is `null`
 * when the article has no `# ` heading — in which case `body` is the input
 * unchanged, since there is no headline to anchor the preamble cut.
 *
 * Only the first ATX-style `# ` heading is recognised; sub-headings and Setext
 * underline syntax are ignored. Lines inside fenced code blocks (``` or ~~~)
 * are skipped so a `# foo` in a code sample isn't mistaken for the headline.
 *
 * Pure and dependency-free so both the server (article projection) and the
 * client can import without pulling a markdown parser.
 */
export const splitLeadingHeading = (md: string): SplitHeading => {
  const lines = md.split("\n");
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
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
    if (match) {
      const rest = lines.slice(i + 1);
      while (rest.length > 0 && rest[0].trim() === "") rest.shift();
      return { heading: stripInlineMarkdown(match[1]).trim(), body: rest.join("\n") };
    }
  }
  return { heading: null, body: md };
};

/**
 * Extract the first ATX-style `# ` heading from a markdown string as plain
 * display text, or `null` when none is present. Thin wrapper over
 * {@link splitLeadingHeading} for callers that only need the headline.
 */
export const extractFirstHeading = (md: string): string | null => splitLeadingHeading(md).heading;
