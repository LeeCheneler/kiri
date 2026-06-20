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
              area: "providers",
              level: "ok",
              title: "1 LLM provider configured",
              detail: "anthropic",
            },
            {
              area: "web-search",
              level: "degraded",
              title: "Web search disabled",
              detail: "TAVILY_API_KEY is not set",
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

    expect(await screen.findByText("Web search disabled")).toBeDefined();
    expect(screen.getByText("kiri.yaml failed to load")).toBeDefined();
    // The ok check is not surfaced, even after the report resolves.
    expect(screen.queryByText("1 LLM provider configured")).toBeNull();
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
