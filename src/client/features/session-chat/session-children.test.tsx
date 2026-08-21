import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { ChildSessionEntry } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionChildren } from "./session-children.tsx";

const NOW = new Date("2026-08-21T12:00:00.000Z");

const child = (overrides: Partial<ChildSessionEntry> = {}): ChildSessionEntry => ({
  id: "child-1",
  status: "running",
  projectId: null,
  model: "anthropic:claude",
  imageModel: null,
  effort: "low",
  cwd: null,
  title: "Pelican census",
  parentSessionId: "parent-1",
  parentToolCallId: "c1",
  startedAt: "2026-08-21T11:00:00.000Z",
  finishedAt: null,
  error: null,
  lastActivityAt: "2026-08-21T11:55:00.000Z",
  ...overrides,
});

const withChildren = (children: ChildSessionEntry[]) =>
  server.use(http.get("*/api/sessions/parent-1/children", () => HttpResponse.json({ children })));

const renderWorkers = () => {
  const { hook } = memoryLocation({ path: "/sessions/parent-1" });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <SessionChildren id="parent-1" now={NOW} />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<SessionChildren>", () => {
  it("renders nothing while the session has delegated nothing", async () => {
    withChildren([]);
    const { container } = renderWorkers();

    // Settle the query before asserting the section never appeared.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.innerHTML).toBe("");
  });

  it("lists each worker with its status and recency, linking through", async () => {
    withChildren([
      child(),
      child({
        id: "child-2",
        title: "Heron census",
        status: "waiting",
        lastActivityAt: "2026-08-21T11:58:00.000Z",
      }),
    ]);
    renderWorkers();

    const link = await screen.findByRole("link", { name: "Pelican census" });
    expect(link.getAttribute("href")).toBe("/sessions/child-1");
    // The shared vocabulary: a running child reads as working, and a child
    // paused on tool approval reads as waiting — its own distinct state.
    expect(screen.getByText("working").getAttribute("data-status")).toBe("working");
    expect(screen.getByText("waiting").getAttribute("data-status")).toBe("waiting");
    // Recency from the children listing's lastActivityAt, against noon.
    expect(screen.getByText("5 minutes ago")).toBeDefined();
    expect(screen.getByText("2 minutes ago")).toBeDefined();
    expect(screen.getByRole("link", { name: "Heron census" })).toBeDefined();
  });

  it("stands the short id in for an untitled worker", async () => {
    withChildren([child({ id: "aaaabbbb-cccc-dddd", title: null })]);
    renderWorkers();

    const link = await screen.findByRole("link", { name: "aaaabbbb" });
    expect(link.getAttribute("href")).toBe("/sessions/aaaabbbb-cccc-dddd");
  });
});
