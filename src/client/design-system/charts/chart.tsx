import { useMemo, useState } from "react";
import { VegaEmbed } from "react-vega";
import type { EmbedOptions, VisualizationSpec } from "vega-embed";

const REMOTE_DATA_MESSAGE = "charts may not load remote data";

// Vega's loader is the single chokepoint for every external fetch a spec
// can trigger — `data.url`, image-mark sources, geoshape URLs. Article
// content is untrusted, so all of them are rejected: a chart may only
// render the inline `data.values` it ships with.
const rejectRemoteFetch = (): Promise<never> => Promise.reject(new Error(REMOTE_DATA_MESSAGE));
const offlineLoader = {
  load: rejectRemoteFetch,
  sanitize: rejectRemoteFetch,
  http: rejectRemoteFetch,
  file: rejectRemoteFetch,
} as unknown as EmbedOptions["loader"];

// True if any `data` block in the spec names a remote `url`. A spec that
// only carries inline `data.values` returns false — and a data row that
// happens to have a field called `url` is not mistaken for a data source,
// since the `url` there sits under `values`, not directly on `data`.
function referencesRemoteData(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(referencesRemoteData);
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (typeof data === "object" && data !== null && "url" in data) {
    return true;
  }
  return Object.values(record).some(referencesRemoteData);
}

function ChartError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-4 border border-rule bg-paper p-4 font-mono text-sm text-status-failed"
    >
      {message}
    </p>
  );
}

// Builds a Vega config from the site's design tokens, read off `:root`
// at render time. Pulling the live values keeps every chart in step with
// the page instead of duplicating colours that would drift.
function themedVegaConfig(): EmbedOptions["config"] {
  const root = getComputedStyle(document.documentElement);
  const token = (name: string) => root.getPropertyValue(name).trim();

  const ink = token("--color-ink");
  const inkMuted = token("--color-ink-muted");
  const paper = token("--color-paper");
  const rule = token("--color-rule");
  const accent = token("--color-accent");
  const mono = token("--font-mono");

  const config = {
    background: "transparent",
    font: mono,
    // Drop Vega's default border rectangle around the plotting area.
    view: { stroke: null },
    // A visible gap between adjacent arc (donut/pie) segments.
    arc: { stroke: paper },
    title: { color: ink, font: mono, fontSize: 13, fontWeight: 600, anchor: "start" },
    axis: {
      labelColor: inkMuted,
      titleColor: ink,
      labelFont: mono,
      titleFont: mono,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      domainColor: rule,
      tickColor: rule,
      gridColor: rule,
      gridOpacity: 0.5,
    },
    legend: {
      labelColor: inkMuted,
      titleColor: ink,
      labelFont: mono,
      titleFont: mono,
      labelFontSize: 11,
      titleFontSize: 11,
    },
    // Facet/repeat header labels default to black — invisible on the
    // dark theme without an explicit colour.
    header: { labelColor: inkMuted, titleColor: ink, labelFont: mono, titleFont: mono },
    range: {
      category: [
        accent,
        token("--color-status-running"),
        token("--color-status-ok"),
        token("--color-status-interrupted"),
        token("--color-status-failed"),
        inkMuted,
      ],
      // Three stops so sequential scales (heatmaps, gradient legends)
      // keep a legible mid-range on the dark canvas — a two-stop ramp
      // from `rule` to `accent` muddies everything in between.
      heatmap: [rule, inkMuted, accent],
      ramp: [rule, inkMuted, accent],
    },
    mark: { color: accent },
  };

  // vega-embed types `config` as a Vega config; in vega-lite mode it
  // accepts a Vega-Lite config, which carries fields like `view`.
  return config as unknown as EmbedOptions["config"];
}

/**
 * Renders a Vega-Lite chart from the JSON spec in a fenced `chart` code
 * block. The spec is parsed at render time; malformed JSON, a spec
 * Vega-Lite rejects, or a spec reaching for remote data degrades to an
 * inline error notice rather than breaking the surrounding article.
 *
 * The chart inherits the site's design tokens, compiles as Vega-Lite,
 * renders as SVG with the export menu hidden, and runs with Vega's
 * loader locked down so no spec can fetch a URL.
 */
export function Chart({ source }: { source: string }) {
  const [renderError, setRenderError] = useState<string | null>(null);
  const config = useMemo(themedVegaConfig, []);

  let spec: VisualizationSpec;
  try {
    spec = JSON.parse(source) as VisualizationSpec;
  } catch {
    return <ChartError message="Chart spec is not valid JSON." />;
  }

  // Refuse remote data before rendering: Vega would otherwise draw an
  // empty chart scaffold and fetch the URL asynchronously. Catching it
  // here degrades cleanly to a notice instead. The loader above is the
  // backstop for any other fetch vector (image marks, etc.).
  if (referencesRemoteData(spec)) {
    return <ChartError message="Charts may not load remote data." />;
  }

  if (renderError !== null) {
    return <ChartError message={`Chart could not be rendered: ${renderError}`} />;
  }

  const options: EmbedOptions = {
    mode: "vega-lite",
    renderer: "svg",
    actions: false,
    tooltip: { theme: "dark" },
    loader: offlineLoader,
    config,
  };

  return (
    <figure className="mt-4 overflow-x-auto border border-rule bg-paper p-4">
      <VegaEmbed
        spec={spec}
        options={options}
        onError={(err) => setRenderError(err instanceof Error ? err.message : String(err))}
        // vega-embed's container defaults to `display: inline-block`,
        // which collapses to zero width under a `"width": "container"`
        // spec. Forcing block layout lets the chart fill the column.
        style={{ display: "block", width: "100%" }}
      />
    </figure>
  );
}
