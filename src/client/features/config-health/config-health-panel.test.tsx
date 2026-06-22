import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ConfigHealthPanel } from "./config-health-panel.tsx";

const renderPanel = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe("<ConfigHealthPanel>", () => {
  it("surfaces the non-ok checks, mapping level to tone, and hides ok ones", async () => {
    server.use(
      http.get("*/api/config/health", () =>
        HttpResponse.json({
          checks: [
            {
              area: "mcp",
              level: "ok",
              title: "1 MCP server configured",
              detail: "linear",
            },
            {
              area: "providers",
              level: "degraded",
              title: "No LLM providers configured",
              detail: "Declare a provider in kiri.yaml.",
            },
            {
              area: "config",
              level: "error",
              title: "kiri.yaml failed to load",
              detail: "bad yaml",
            },
          ],
        }),
      ),
    );
    const { container } = renderPanel(<ConfigHealthPanel />);

    expect(await screen.findByText("No LLM providers configured")).toBeDefined();
    expect(screen.getByText("kiri.yaml failed to load")).toBeDefined();
    // The ok check is not surfaced, even after the report resolves.
    expect(screen.queryByText("1 MCP server configured")).toBeNull();
    // A degraded check reads as a warning, an error as a negative.
    expect(container.querySelector("[data-tone='warning']")).not.toBeNull();
    expect(container.querySelector("[data-tone='negative']")).not.toBeNull();
  });

  it("renders nothing when every check is ok", async () => {
    server.use(
      http.get("*/api/config/health", () =>
        HttpResponse.json({
          checks: [{ area: "providers", level: "ok", title: "All good", detail: "anthropic" }],
        }),
      ),
    );
    const { container } = renderPanel(<ConfigHealthPanel />);

    // The query resolves to an all-ok report; the banner stays absent.
    await waitFor(() => expect(screen.queryByText("All good")).toBeNull());
    expect(container.firstChild).toBeNull();
  });
});
