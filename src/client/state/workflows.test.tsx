import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "./query-client.ts";
import { useWorkflows, useWorkflowsLive } from "./workflows.ts";

const workflow = (name: string) => ({ name, steps: [] });

const Probe = () => {
  useWorkflowsLive();
  const { data } = useWorkflows();
  return (
    <ul>
      {(data ?? []).map((w) => (
        <li key={w.name}>{w.name}</li>
      ))}
    </ul>
  );
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

describe("workflows state", () => {
  it("fetches and exposes the workflow registry", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([workflow("deploy"), workflow("release")]),
      ),
    );
    renderProbe();
    expect(await screen.findByText("deploy")).toBeDefined();
    expect(screen.getByText("release")).toBeDefined();
  });

  it("refetches the registry when a workflow definition changes", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow("deploy")])));
    const { sources } = renderProbe();
    await screen.findByText("deploy");

    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([workflow("deploy"), workflow("backup")]),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "workflow.added", name: "backup" });
    });

    expect(await screen.findByText("backup")).toBeDefined();
  });
});
