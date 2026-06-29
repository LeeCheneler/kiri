import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useMcpServers, useMcpServersLive, useMcpTools, useMcpToolsLive } from "./mcp.ts";
import { createQueryClient } from "./query-client.ts";

const Probe = () => {
  useMcpServersLive();
  const servers = useMcpServers().data?.servers ?? [];
  return <p>servers:{servers.length}</p>;
};

const ToolsProbe = () => {
  useMcpToolsLive();
  const servers = useMcpTools().data?.servers ?? [];
  return <p>tools-servers:{servers.length}</p>;
};

const renderProbe = (ui = <Probe />) => {
  const { factory, sources } = captureEventSources();
  const rendered = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, sources };
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

  it("refetches the tool listing on a config change", async () => {
    server.use(
      http.get("*/api/mcp/tools", () => HttpResponse.json({ servers: [{ name: "linear" }] })),
    );
    const { sources } = renderProbe(<ToolsProbe />);
    expect(await screen.findByText("tools-servers:1")).toBeDefined();

    server.use(
      http.get("*/api/mcp/tools", () =>
        HttpResponse.json({ servers: [{ name: "linear" }, { name: "files" }] }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "config.changed" });
    });
    expect(await screen.findByText("tools-servers:2")).toBeDefined();
  });
});
