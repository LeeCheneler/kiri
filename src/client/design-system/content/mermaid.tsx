import mermaid from "mermaid";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "../actions/button.tsx";
import { CopyButton } from "../actions/copy-button.tsx";
import { Tabs } from "../navigation/tabs.tsx";
import { Modal } from "../surfaces/modal.tsx";
import { CodeBlock } from "./code.tsx";

// mermaid's `theme: "base"` exposes every colour as a theme variable, so the
// diagram can be dressed in the site's own tokens instead of mermaid's
// defaults. Read live off `:root` at render time — the same approach the
// chart renderer takes — so a token change flows through without duplication.
function themedMermaidVariables(): Record<string, string> {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();

  const ink = token("--color-ink");
  const inkMuted = token("--color-ink-muted");
  const paper = token("--color-paper");
  const paper2 = token("--color-paper-2");
  const rule = token("--color-rule");
  const mono = token("--font-mono");

  return {
    darkMode: "true",
    background: paper,
    fontFamily: mono,
    primaryColor: paper2,
    primaryBorderColor: rule,
    primaryTextColor: ink,
    secondaryColor: paper2,
    tertiaryColor: paper,
    mainBkg: paper2,
    nodeBorder: rule,
    nodeTextColor: ink,
    lineColor: inkMuted,
    textColor: ink,
    titleColor: ink,
    clusterBkg: paper,
    clusterBorder: rule,
    edgeLabelBackground: paper,
  };
}

function MermaidError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="border border-rule bg-paper p-4 font-mono text-sm text-status-failed"
    >
      {message}
    </p>
  );
}

function RenderedSvg({ svg, className }: { svg: string; className: string }) {
  return (
    <figure
      className={className}
      // The SVG is mermaid's strict-mode output: DOMPurify has already removed
      // any script or event-handler surface, so the markup is safe to embed.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by mermaid's strict-mode DOMPurify
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// Renders the diagram. mermaid parses the source to an SVG asynchronously, so
// the markup arrives after the first paint; a parse/render failure degrades to
// an inline notice rather than throwing through the surrounding document.
function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const themeVariables = useMemo(themedMermaidVariables, []);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      // strict runs the rendered SVG through DOMPurify, stripping scripts and
      // event handlers, so untrusted diagram source can't smuggle markup out.
      securityLevel: "strict",
      // On a parse failure mermaid otherwise draws a "bomb" error SVG into a
      // temporary node it appends to document.body for layout, then throws
      // without removing it — leaving the bomb stranded at the end of the page.
      // Suppressing it makes mermaid clean up that node and just throw, so the
      // catch below can degrade to our own inline notice with nothing leaked.
      suppressErrorRendering: true,
      theme: "base",
      themeVariables,
    });
    // mermaid uses the id as a DOM id and CSS selector internally; useId's
    // colons aren't selector-safe, so strip them to a bare token.
    const renderId = `mermaid-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`;
    mermaid
      .render(renderId, source)
      .then((result) => {
        if (cancelled) return;
        setError(null);
        setSvg(result.svg);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source, themeVariables, reactId]);

  if (error !== null) {
    return <MermaidError message={`Diagram could not be rendered: ${error}`} />;
  }
  if (svg === null) {
    return <p className="font-mono text-sm text-ink-muted">Rendering diagram…</p>;
  }
  return (
    <div className="relative">
      <RenderedSvg
        svg={svg}
        className="overflow-x-auto border border-rule bg-paper p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      />
      <div className="absolute top-2 right-2">
        <Button onClick={() => setZoomed(true)}>Enlarge</Button>
      </div>
      {zoomed && (
        <Modal title="Diagram" size="full" onClose={() => setZoomed(false)}>
          {/* `w-full` scales the diagram up to fill the wide dialog; the
              container scrolls when even that isn't enough room. */}
          <RenderedSvg
            svg={svg}
            className="overflow-auto [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:w-full"
          />
        </Modal>
      )}
    </div>
  );
}

function MermaidSource({ source }: { source: string }) {
  return (
    <div className="relative">
      <CodeBlock>{source}</CodeBlock>
      <div className="absolute top-2 right-2">
        <CopyButton content={source} label="copy source" />
      </div>
    </div>
  );
}

/**
 * Renders a fenced `mermaid` block as a diagram, with a tab to read the source
 * behind it. The diagram tab is shown first and carries an *Enlarge* action that
 * opens the diagram in a viewport-spanning modal for inspecting large graphs;
 * the source tab carries the raw mermaid text and a copy action. mermaid renders
 * in `strict` security mode (DOMPurify-sanitised SVG) and is themed from the
 * site's design tokens, so a malformed or hostile diagram degrades to an inline
 * notice instead of breaking the surrounding article.
 */
export function Mermaid({ source }: { source: string }) {
  return (
    <Tabs
      local
      label="Mermaid diagram"
      tabs={[
        { id: "diagram", label: "Diagram", content: <MermaidDiagram source={source} /> },
        { id: "source", label: "Source", content: <MermaidSource source={source} /> },
      ]}
    />
  );
}
