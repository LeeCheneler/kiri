import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { McpStatusPanel } from "./mcp-status-panel.tsx";

const renderPanel = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe("<McpStatusPanel>", () => {
  it("offers Connect for a sign-in server, shows a failed server's error, and hides connected", async () => {
    server.use(
      http.get("*/api/mcp/servers", () =>
        HttpResponse.json({
          servers: [
            { name: "linear", type: "http", state: "needs-sign-in" },
            { name: "broken", type: "http", state: "failed", error: "Unable to connect" },
            { name: "files", type: "stdio", state: "connected", toolCount: 3 },
          ],
        }),
      ),
    );

    const opened: string[] = [];
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;

    try {
      const { container } = renderPanel(<McpStatusPanel />);

      const connect = await screen.findByRole("button", { name: "Connect" });
      expect(screen.getByText("linear needs sign-in")).toBeDefined();
      expect(screen.getByText("broken failed to connect")).toBeDefined();
      expect(screen.getByText("Unable to connect")).toBeDefined();
      // A connected server is not surfaced.
      expect(screen.queryByText(/^files/)).toBeNull();
      // The sign-in server reads as a warning, the failed one as a negative.
      expect(container.querySelector("[data-tone='warning']")).not.toBeNull();
      expect(container.querySelector("[data-tone='negative']")).not.toBeNull();

      await userEvent.click(connect);
      expect(opened[0]).toContain("/api/mcp/linear/auth/start");
    } finally {
      window.open = originalOpen;
    }
  });
});
