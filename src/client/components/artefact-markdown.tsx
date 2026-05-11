import type { AnchorHTMLAttributes } from "react";
import Markdown, { type ExtraProps } from "react-markdown";

const isExternalHref = (href: string): boolean => {
  if (href.length === 0) return false;
  if (href.startsWith("#") || href.startsWith("/")) return false;
  try {
    const url = new URL(href, window.location.href);
    return url.origin !== window.location.origin;
  } catch {
    return false;
  }
};

// `react-markdown` passes the AST `node` through to custom components.
// Destructure and drop it so it never lands as a stray DOM attribute.
function ExternalSafeAnchor({
  href,
  children,
  node: _node,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  if (href !== undefined && isExternalHref(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/**
 * Render a published artefact's markdown body. Built on `react-markdown`,
 * which parses markdown to React elements directly — there is no HTML
 * string and no `dangerouslySetInnerHTML` call site at all. Raw HTML in
 * the source is not parsed: literal tags like `<script>` land as text,
 * not as elements. `react-markdown`'s built-in `defaultUrlTransform`
 * refuses `javascript:` and unsafe `data:` URLs on links and images.
 *
 * External anchors (different origin from the SPA) are decorated with
 * `target="_blank"` and `rel="noopener noreferrer"`; same-origin and
 * fragment links are left untouched.
 */
export function ArtefactMarkdown({ content }: { content: string }) {
  return (
    <div className="artefact-markdown">
      <Markdown components={{ a: ExternalSafeAnchor }}>{content}</Markdown>
    </div>
  );
}
