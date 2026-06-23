import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useMcpServers, useMcpServersLive } from "./mcp.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = () => {
  useMcpServersLive();
  const servers = useMcpServers().data?.servers ?? [];
  return <p>servers:{servers.length}</p>;
};

const renderProbe = () => {
  const { factory, sources } = captureEventSources();
  const ui = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Probe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...ui, sources };
};

describe("mcp state", () => {
  it("refetches the server status on a config change", async () => {
    server.use(
      http.get("*/api/mcp/servers", () =>
        HttpResponse.json({ servers: [{ name: "linear", type: "http", state: "needs-sign-in" }] }),
      ),
    );
    const { sources } = renderProbe();
    expect(await screen.findByText("servers:1")).toBeDefined();

    // Sign-in completes (or kiri.yaml changes): the server connects and another appears.
    server.use(
      http.get("*/api/mcp/servers", () =>
        HttpResponse.json({
          servers: [
            { name: "linear", type: "http", state: "connected", toolCount: 2 },
            { name: "files", type: "stdio", state: "connected", toolCount: 1 },
          ],
        }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "config.changed" });
    });
    expect(await screen.findByText("servers:2")).toBeDefined();
  });
});
