import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type OlHTMLAttributes,
  Suspense,
  createElement,
  isValidElement,
  lazy,
} from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code, CodeBlock } from "./code.tsx";
import { InlineLink } from "./inline-link.tsx";
import { List } from "./list.tsx";
import { Prose } from "./prose.tsx";
import { Quote } from "./quote.tsx";
import { Rule } from "./rule.tsx";
import { Table } from "./table.tsx";

// Vega and its dependencies weigh ~290 KB gzipped. Loading the chart
// component lazily keeps them in a separate chunk fetched only when a
// document actually contains a `chart` block — chart-free pages pay
// nothing.
const Chart = lazy(() => import("../charts/chart.tsx").then((m) => ({ default: m.Chart })));

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
// component. Each component below drops it so it never leaks to the DOM.

function Anchor({
  href,
  children,
  node: _node,
}: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  const target = href ?? "";
  return (
    <InlineLink href={target} external={isExternalHref(target)}>
      {children}
    </InlineLink>
  );
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

// Visual styling per *authored* heading level, drawn from the Foundations
// type scale. The rendered element tag may shift with
// `downgradeHeaderLevels`, but the visual prominence follows whatever the
// author wrote — so `# x` always reads as the most prominent heading, even
// when it lands at <h2> or <h3>.
const HEADING_CLASSES: Record<HeadingLevel, string> = {
  1: "mt-10 mb-4 font-display text-3xl text-ink leading-tight first:mt-0",
  2: "mt-8 mb-3 font-display text-2xl text-ink leading-tight",
  3: "mt-6 mb-2 font-display text-xl text-ink leading-tight",
  4: "mt-6 mb-2 font-display text-lg text-ink",
  5: "mt-4 mb-2 font-display text-base text-ink",
  6: "mt-4 mb-2 text-xs tracking-widest text-ink-muted uppercase",
};

const clampLevel = (level: number): HeadingLevel => Math.max(1, Math.min(6, level)) as HeadingLevel;

const buildHeading = (source: HeadingLevel, target: HeadingLevel): Components["h1"] => {
  return function Heading({
    node: _node,
    children,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
    return createElement(`h${target}`, { className: HEADING_CLASSES[source], ...rest }, children);
  };
};

function Paragraph({
  node: _node,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & ExtraProps) {
  return (
    <p className="mt-3.5 text-base leading-7 text-ink first:mt-0" {...rest}>
      {children}
    </p>
  );
}

function UnorderedList({ node: _node, children }: HTMLAttributes<HTMLUListElement> & ExtraProps) {
  return (
    <div className="mt-4">
      <List>{children}</List>
    </div>
  );
}

function OrderedList({ node: _node, children }: OlHTMLAttributes<HTMLOListElement> & ExtraProps) {
  return (
    <div className="mt-4">
      <List ordered>{children}</List>
    </div>
  );
}

function Blockquote({ node: _node, children }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return (
    <div className="mt-4">
      <Quote>{children}</Quote>
    </div>
  );
}

function HorizontalRule(_props: HTMLAttributes<HTMLHRElement> & ExtraProps) {
  return (
    <div className="my-8">
      <Rule />
    </div>
  );
}

function Strong({ node: _node, children, ...rest }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return (
    <strong className="font-display font-medium text-ink" {...rest}>
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

// react-markdown renders inline `code` and the `<code>` inside a fenced
// block through this same `code` slot. Inline code gets the chip treatment;
// fenced code is intercepted by `Pre`, which reads the language and text off
// this element directly and renders a `CodeBlock`, so the block case never
// reaches here.
function CodeNode({ node: _node, children }: HTMLAttributes<HTMLElement> & ExtraProps) {
  return <Code>{children}</Code>;
}

function Pre({ node: _node, children }: HTMLAttributes<HTMLPreElement> & ExtraProps) {
  // A fenced ```chart block reaches `Pre` as a single `<code>` child tagged
  // `language-chart`. Route those to the lazy chart renderer.
  if (isValidElement<{ className?: string; children?: string }>(children)) {
    const language = children.props.className ?? "";
    if (language.split(" ").includes("language-chart")) {
      const source = typeof children.props.children === "string" ? children.props.children : "";
      return (
        <div className="mt-4">
          <Suspense fallback={<p className="font-mono text-sm text-ink-muted">Loading chart…</p>}>
            <Chart source={source} />
          </Suspense>
        </div>
      );
    }
  }
  // Every other fence is a code block. Pull the text out of the `<code>`
  // child so CodeBlock's own `<code>` wrapper isn't double-nested.
  const text =
    isValidElement<{ children?: string }>(children) && typeof children.props.children === "string"
      ? children.props.children
      : "";
  return (
    <div className="mt-4">
      <CodeBlock>{text}</CodeBlock>
    </div>
  );
}

function Image({
  node: _node,
  className,
  alt,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  // Alt text comes from the markdown source — `![alt](url)`. An empty alt
  // is the HTML convention for "decorative, skip in screen readers"; we
  // pass through whatever the author wrote.
  // biome-ignore lint/a11y/useAltText: alt is sourced from the markdown image syntax
  return <img className={className ?? "mt-4 h-auto max-w-full"} alt={alt ?? ""} {...rest} />;
}

function TableNode({ node: _node, children }: HTMLAttributes<HTMLTableElement> & ExtraProps) {
  return (
    <div className="mt-4">
      <Table>{children}</Table>
    </div>
  );
}

const baseComponents: Components = {
  a: Anchor,
  h1: buildHeading(1, 1),
  h2: buildHeading(2, 2),
  h3: buildHeading(3, 3),
  h4: buildHeading(4, 4),
  h5: buildHeading(5, 5),
  h6: buildHeading(6, 6),
  p: Paragraph,
  ul: UnorderedList,
  ol: OrderedList,
  blockquote: Blockquote,
  hr: HorizontalRule,
  strong: Strong,
  em: Emphasis,
  del: Strike,
  code: CodeNode,
  pre: Pre,
  img: Image,
  table: TableNode,
};

/**
 * Render a markdown string as React elements, leaning on the design-system
 * content components for its rendering. Built on `react-markdown`, which
 * parses markdown to React elements directly — there is no HTML string and
 * no `dangerouslySetInnerHTML`. Raw HTML in the source is not parsed:
 * literal tags like `<script>` land as text, not elements.
 * `react-markdown`'s `defaultUrlTransform` refuses `javascript:` and unsafe
 * `data:` URLs on links and images.
 *
 * Output is wrapped in `Prose` so it inherits the reading measure and
 * voice. Links render through `InlineLink`, lists through `List`,
 * blockquotes through `Quote`, rules through `Rule`, tables through `Table`,
 * and code through `Code` / `CodeBlock`. Headings carry the Foundations type
 * scale.
 *
 * `downgradeHeaderLevels` shifts every authored heading down by N levels in
 * the rendered output, clamped at h6 — for surfaces whose route owns an
 * outer heading and needs body `# section` to slot in beneath it.
 *
 * `withSectionOrdinals` stamps every authored `# …` top-level heading with a
 * deterministic id (`section-01`, …) and a leading `§ NN` mono eyebrow, at
 * whatever rendered level the downgrade lands it on. Ordinals key off AST
 * node identity so React StrictMode's double-render doesn't double-count.
 */
export function Markdown({
  content,
  withSectionOrdinals = false,
  downgradeHeaderLevels = 0,
}: {
  content: string;
  withSectionOrdinals?: boolean;
  downgradeHeaderLevels?: number;
}) {
  const resolvedComponents = buildMarkdownComponents({
    downgrade: downgradeHeaderLevels,
    withSectionOrdinals,
  });
  return (
    <Prose>
      <ReactMarkdown components={resolvedComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </Prose>
  );
}

const buildMarkdownComponents = ({
  downgrade,
  withSectionOrdinals,
}: {
  downgrade: number;
  withSectionOrdinals: boolean;
}): Components => {
  if (downgrade === 0 && !withSectionOrdinals) return baseComponents;
  const result: Components = { ...baseComponents };
  // Ordinals follow the authored top-level heading (`# …`) wherever the
  // downgrade lands it. The rendered element shifts; the source slot we
  // override stays h1.
  for (let source = 1 as HeadingLevel; source <= 6; source++) {
    const target = clampLevel(source + downgrade);
    const key = `h${source}` as const;
    result[key] =
      withSectionOrdinals && source === 1
        ? buildOrdinalHeading(source, target)
        : buildHeading(source, target);
  }
  return result;
};

/**
 * Build a stateful heading renderer that assigns each heading an
 * `id="section-NN"` and a `§ NN` mono eyebrow in document order. The counter
 * is keyed by AST `node` identity rather than a plain increment: when
 * react-markdown invokes the same heading twice (StrictMode's double-render)
 * the second invocation finds its node in the Map and returns the same
 * ordinal instead of bumping the count.
 */
const buildOrdinalHeading = (source: HeadingLevel, target: HeadingLevel): Components["h1"] => {
  const ordinals = new Map<unknown, number>();
  return function OrdinalHeading({
    node,
    children,
    ...rest
  }: HTMLAttributes<HTMLHeadingElement> & ExtraProps) {
    let ordinal = ordinals.get(node);
    if (ordinal === undefined) {
      ordinal = ordinals.size + 1;
      ordinals.set(node, ordinal);
    }
    const nn = String(ordinal).padStart(2, "0");
    return createElement(
      `h${target}`,
      { id: `section-${nn}`, className: HEADING_CLASSES[source], ...rest },
      <span
        key="eyebrow"
        aria-hidden="true"
        className="mb-1.5 block font-mono text-xs tracking-widest text-ink-faint uppercase"
      >
        § {nn}
      </span>,
      children,
    );
  };
};
