import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import { lastEmbed, mockReactVega, resetEmbed } from "../../../tests/setup/react-vega-mock.tsx";

mockReactVega();
const { Chart } = await import("./chart.tsx");

// The values the Vega config is expected to be built from. Tests that
// assert on the config set these on `:root` first; `themedVegaConfig`
// reads them back via `getComputedStyle`.
const DESIGN_TOKENS: Record<string, string> = {
  "--color-ink": "#e5dfd2",
  "--color-ink-muted": "#8b8579",
  "--color-paper": "#1a1b19",
  "--color-rule": "#2a2a26",
  "--color-accent": "#d6b85a",
  "--color-status-running": "#7aaedb",
  "--color-status-ok": "#88a579",
  "--color-status-interrupted": "#c99858",
  "--color-status-failed": "#d1493e",
  "--font-mono": "JetBrains Mono, monospace",
};

afterEach(() => {
  cleanup();
  resetEmbed();
  for (const name of Object.keys(DESIGN_TOKENS)) {
    document.documentElement.style.removeProperty(name);
  }
});

const VALID_SPEC = {
  data: { values: [{ category: "A", value: 4 }] },
  mark: "bar",
  encoding: {
    x: { field: "category", type: "nominal" },
    y: { field: "value", type: "quantitative" },
  },
};

const REMOTE_DATA_SPEC = { data: { url: "https://example.com/d.json" }, mark: "bar" };

interface VegaConfigShape {
  background: string;
  axis: { titleColor: string; labelColor: string };
  legend: { titleColor: string };
  header: { titleColor: string };
  range: { category: string[]; heatmap: string[]; ramp: string[] };
  mark: { color: string };
}

describe("<Chart>", () => {
  it("renders a Vega-Lite chart from a valid JSON spec", () => {
    render(<Chart source={JSON.stringify(VALID_SPEC)} />);

    expect(screen.getByRole("figure")).toBeDefined();
    const embed = lastEmbed();
    if (embed === null) throw new Error("VegaEmbed was not rendered");
    expect(embed.spec).toEqual(VALID_SPEC);
    expect(embed.options.mode).toBe("vega-lite");
    expect(embed.options.renderer).toBe("svg");
    expect(embed.options.actions).toBe(false);
  });

  it("degrades to an inline alert when the spec is not valid JSON", () => {
    render(<Chart source={"{ not json"} />);

    expect(screen.getByRole("alert").textContent).toMatch(/not valid JSON/i);
    // VegaEmbed is never reached when the spec fails to parse.
    expect(lastEmbed()).toBeNull();
  });

  it("degrades to an inline alert when Vega reports a render error", () => {
    render(<Chart source={JSON.stringify(VALID_SPEC)} />);
    const embed = lastEmbed();
    if (embed === null) throw new Error("VegaEmbed was not rendered");

    act(() => {
      embed.onError(new Error("invalid specification"));
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/could not be rendered/i);
    expect(alert.textContent).toMatch(/invalid specification/i);
  });

  it("refuses remote data fetches through the Vega loader", async () => {
    render(<Chart source={JSON.stringify(VALID_SPEC)} />);
    const embed = lastEmbed();
    if (embed === null) throw new Error("VegaEmbed was not rendered");

    const loader = embed.options.loader as { load: (uri: string) => Promise<unknown> };
    await expect(loader.load("https://example.com/data.json")).rejects.toThrow(/remote data/i);
  });

  it("degrades to an inline alert when the spec names a remote data source", () => {
    render(<Chart source={JSON.stringify(REMOTE_DATA_SPEC)} />);

    expect(screen.getByRole("alert").textContent).toMatch(/remote data/i);
    // The spec is refused before VegaEmbed is ever reached.
    expect(lastEmbed()).toBeNull();
  });

  it("builds the chart config from the site design tokens", () => {
    for (const [name, value] of Object.entries(DESIGN_TOKENS)) {
      document.documentElement.style.setProperty(name, value);
    }

    render(<Chart source={JSON.stringify(VALID_SPEC)} />);
    const embed = lastEmbed();
    if (embed === null) throw new Error("VegaEmbed was not rendered");

    const config = embed.options.config as VegaConfigShape;
    // Transparent so the chart sits on the article's own surface — no
    // white card background.
    expect(config.background).toBe("transparent");
    expect(config.axis.titleColor).toBe(DESIGN_TOKENS["--color-ink"]);
    expect(config.axis.labelColor).toBe(DESIGN_TOKENS["--color-ink-muted"]);
    expect(config.legend.titleColor).toBe(DESIGN_TOKENS["--color-ink"]);
    expect(config.header.titleColor).toBe(DESIGN_TOKENS["--color-ink"]);
    // Accent leads the categorical palette.
    expect(config.range.category[0]).toBe(DESIGN_TOKENS["--color-accent"]);
    // Sequential scales ramp through three token stops.
    const sequential = [
      DESIGN_TOKENS["--color-rule"],
      DESIGN_TOKENS["--color-ink-muted"],
      DESIGN_TOKENS["--color-accent"],
    ];
    expect(config.range.heatmap).toEqual(sequential);
    expect(config.range.ramp).toEqual(sequential);
    expect(config.mark.color).toBe(DESIGN_TOKENS["--color-accent"]);
  });
});
