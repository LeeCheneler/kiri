/** Where a wiki-link lands: the article's page and the title the link reads as. */
export interface WikiLinkTarget {
  href: string;
  label: string;
}

/**
 * Resolve a `[[slug]]` reference to its target, or null when nothing owns
 * that slug — an unresolved reference renders as the literal text it was.
 */
export type WikiLinkResolver = (slug: string) => WikiLinkTarget | null;

// The same shape `articleSlugSchema` accepts, anchored inside the brackets —
// anything else (spaces, uppercase, empty) is left as plain text.
const WIKI_LINK = /\[\[([a-z0-9][a-z0-9-]*)\]\]/g;

// The two mdast shapes the walker touches, structurally typed so the plugin
// needs no mdast type dependency.
interface TextNode {
  type: "text";
  value: string;
}
interface ParentNode {
  type: string;
  children: unknown[];
}

const isText = (node: unknown): node is TextNode =>
  typeof node === "object" &&
  node !== null &&
  (node as { type?: unknown }).type === "text" &&
  typeof (node as { value?: unknown }).value === "string";

const isParent = (node: unknown): node is ParentNode =>
  typeof node === "object" && node !== null && Array.isArray((node as ParentNode).children);

/**
 * A remark plugin turning `[[slug]]` references in text into links via
 * `resolve`. Only plain text is rewritten — code blocks and inline code
 * carry their value outside text nodes, so the syntax survives there
 * literally — and a reference `resolve` disowns stays as written.
 */
export function remarkWikiLinks(resolve: WikiLinkResolver) {
  const splitText = (node: TextNode): unknown[] => {
    const out: unknown[] = [];
    let last = 0;
    WIKI_LINK.lastIndex = 0;
    for (const match of node.value.matchAll(WIKI_LINK)) {
      const target = resolve(match[1] as string);
      if (target === null) continue;
      if (match.index > last)
        out.push({ type: "text", value: node.value.slice(last, match.index) });
      out.push({
        type: "link",
        url: target.href,
        children: [{ type: "text", value: target.label }],
      });
      last = match.index + match[0].length;
    }
    if (out.length === 0) return [node];
    if (last < node.value.length) out.push({ type: "text", value: node.value.slice(last) });
    return out;
  };

  const walk = (node: unknown): void => {
    if (!isParent(node)) return;
    const next: unknown[] = [];
    for (const child of node.children) {
      if (isText(child)) {
        next.push(...splitText(child));
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };

  return () => walk;
}
