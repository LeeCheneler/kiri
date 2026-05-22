import {
  type AnchorHTMLAttributes,
  type BlockquoteHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type OlHTMLAttributes,
  Suspense,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  isValidElement,
  lazy,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";

// Vega and its dependencies weigh ~290 KB gzipped. Loading the chart
// component lazily keeps them in a separate chunk fetched only when an
// article actually contains a `chart` block — chart-free pages pay
// nothing.
const Chart = lazy(() => import("./chart.tsx").then((m) => ({ default: m.Chart })));

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

// `react-markdown` passes the AST `node` through to every custom
// component. Each component below destructures and drops it so it never
// leaks to the DOM as a stray attribute.

function Anchor({
  href,
  children,
  node: _node,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  // `relative` is intentional: it keeps the anchor clickable when the
  // surrounding container uses a stacked-link pattern (an absolute
  // `::before` overlay covering the row, e.g. the activity feed). On
  // surfaces without an overlay it's a no-op — no inset, no z-index.
  const classes =
    "relative text-accent underline underline-offset-2 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-1 focus-visible:outline-accent";
  if (href !== undefined && isExternalHref(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className ?? classes}
        {...rest}
      >
        {children}
      </a>
    );
  }
  return (
    <a href={href} className={className ?? classes} {...rest}>
      {children}
    </a>
  );
}

function Heading1({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h1 className="mt-10 mb-4 font-display text-3xl text-ink leading-tight first:mt-0" {...rest}>
      {children}
    </h1>
  );
}

function Heading2({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h2 className="mt-8 mb-3 font-display text-2xl text-ink leading-tight" {...rest}>
      {children}
    </h2>
  );
}

function Heading3({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h3 className="mt-6 mb-2 font-display text-xl text-ink leading-tight" {...rest}>
      {children}
    </h3>
  );
}

function Heading4({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h4 className="mt-6 mb-2 font-display text-lg text-ink" {...rest}>
      {children}
    </h4>
  );
}

function Heading5({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h5 className="mt-4 mb-2 font-display text-base text-ink" {...rest}>
      {children}
    </h5>
  );
}

function Heading6({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
  return (
    <h6 className="mt-4 mb-2 text-xs tracking-widest text-ink-muted uppercase" {...rest}>
      {children}
    </h6>
  );
}

function Paragraph({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & ExtraProps) {
  return (
    <p className="mt-4 text-base leading-relaxed text-ink first:mt-0" {...rest}>
      {children}
    </p>
  );
}

function UnorderedList({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLUListElement> & ExtraProps) {
  return (
    <ul className="mt-4 ml-5 list-disc space-y-1 text-ink marker:text-ink-muted" {...rest}>
      {children}
    </ul>
  );
}

function OrderedList({
  node: _node,
  children,
  ...rest
}: OlHTMLAttributes<HTMLOListElement> & ExtraProps) {
  return (
    <ol className="mt-4 ml-5 list-decimal space-y-1 text-ink marker:text-ink-muted" {...rest}>
      {children}
    </ol>
  );
}

function ListItem({ node: _node, children, ...rest }: HTMLAttributes<HTMLLIElement> & ExtraProps) {
  return (
    <li className="leading-relaxed text-ink" {...rest}>
      {children}
    </li>
  );
}

function Blockquote({
  node: _node,
  children,
  ...rest
}: BlockquoteHTMLAttributes<HTMLQuoteElement> & ExtraProps) {
  return (
    <blockquote className="mt-4 border-l-2 border-rule pl-4 text-ink-muted italic" {...rest}>
      {children}
    </blockquote>
  );
}

function HorizontalRule({ node: _node, ...rest }: HTMLAttributes<HTMLHRElement> & ExtraProps) {
  return <hr className="my-8 border-t border-rule" {...rest} />;
}

function Strong({ node: _node, children, ...rest }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return (
    <strong className="font-semibold text-ink" {...rest}>
      {children}
    </strong>
  );
}

function Emphasis({ node: _node, children, ...rest }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return (
    <em className="italic" {...rest}>
      {children}
    </em>
  );
}

function Strike({ node: _node, children, ...rest }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return (
    <del className="text-ink-muted line-through" {...rest}>
      {children}
    </del>
  );
}

// Distinguishes inline `code` from fenced block code. react-markdown
// stamps `className="language-…"` only on fenced blocks that declared a
// language; bare fenced blocks (just ```) get no className. Block-code
// content always contains a trailing newline that inline code can't —
// so newline-in-children is the second signal. Inline code gets the
// chip treatment; fenced code stays bare so the surrounding `<pre>`
// controls the block-level look.
function Code({
  node: _node,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & ExtraProps) {
  const hasLanguage = typeof className === "string" && className.startsWith("language-");
  const text = typeof children === "string" ? children : "";
  const looksBlock = text.includes("\n");
  if (hasLanguage || looksBlock) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  return (
    <code className="rounded-sm bg-paper px-1.5 py-0.5 font-mono text-sm text-ink" {...rest}>
      {children}
    </code>
  );
}

function Pre({ node: _node, children, ...rest }: HTMLAttributes<HTMLPreElement> & ExtraProps) {
  // A fenced ```chart block reaches `Pre` as a single `<code>` child
  // tagged `language-chart`. Route those to the lazy chart renderer;
  // every other fence renders as an ordinary code block.
  if (isValidElement<{ className?: string; children?: string }>(children)) {
    const language = children.props.className ?? "";
    if (language.split(" ").includes("language-chart")) {
      const source = typeof children.props.children === "string" ? children.props.children : "";
      return (
        <Suspense
          fallback={
            <p className="mt-4 border border-rule bg-paper p-4 font-mono text-sm text-ink-muted">
              Loading chart…
            </p>
          }
        >
          <Chart source={source} />
        </Suspense>
      );
    }
  }
  return (
    <pre
      className="mt-4 overflow-x-auto border border-rule bg-paper p-4 font-mono text-sm text-ink"
      {...rest}
    >
      {children}
    </pre>
  );
}

function Image({
  node: _node,
  className,
  alt,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  // Alt text comes from the markdown source — `![alt](url)`. An empty
  // alt is the HTML convention for "decorative image, skip in screen
  // readers"; we pass through whatever the author wrote.
  // biome-ignore lint/a11y/useAltText: alt is sourced from the markdown image syntax
  return <img className={className ?? "mt-4 h-auto max-w-full"} alt={alt ?? ""} {...rest} />;
}

function Table({
  node: _node,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & ExtraProps) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...rest}>
        {children}
      </table>
    </div>
  );
}

function TableHeader({
  node: _node,
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & ExtraProps) {
  return (
    <th className="border-b border-rule px-2 py-1 text-left font-semibold text-ink" {...rest}>
      {children}
    </th>
  );
}

function TableCell({
  node: _node,
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & ExtraProps) {
  return (
    <td className="border-b border-rule px-2 py-1 text-ink" {...rest}>
      {children}
    </td>
  );
}

const components: Components = {
  a: Anchor,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  p: Paragraph,
  ul: UnorderedList,
  ol: OrderedList,
  li: ListItem,
  blockquote: Blockquote,
  hr: HorizontalRule,
  strong: Strong,
  em: Emphasis,
  del: Strike,
  code: Code,
  pre: Pre,
  img: Image,
  table: Table,
  th: TableHeader,
  td: TableCell,
};

/**
 * Render a markdown string as React elements. Built on `react-markdown`,
 * which parses markdown to React elements directly — there is no HTML
 * string and no `dangerouslySetInnerHTML` call site at all. Raw HTML in
 * the source is not parsed: literal tags like `<script>` land as text,
 * not as elements. `react-markdown`'s built-in `defaultUrlTransform`
 * refuses `javascript:` and unsafe `data:` URLs on links and images.
 *
 * Every supported markdown element is rendered through a styled
 * component so the visual surface matches the rest of the SPA without
 * needing a global CSS file. External anchors (different origin from
 * the SPA) are decorated with `target="_blank"` and
 * `rel="noopener noreferrer"`; same-origin and fragment links pass
 * through untouched.
 *
 * Used by every surface that renders markdown — published articles,
 * activity-feed summaries, the run-detail summary block — so each one
 * inherits the same sandboxing and editorial styling.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  );
}
