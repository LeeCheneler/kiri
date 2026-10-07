import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../../tests/setup/fake-event-source.ts";
import { server } from "../../../../tests/setup/msw.ts";
import type { KiriEvent } from "../../../shared/api/events.ts";
import type { WaitingSession } from "../../../shared/api/sessions.ts";
import { LiveEventsProvider } from "../../events/live.tsx";
import { LiveSync } from "../../state/live-sync.tsx";
import { createQueryClient } from "../../state/query-client.ts";
import { NeedsAttentionPanel } from "./needs-attention-panel.tsx";

const session: WaitingSession = {
  id: "worker",
  label: "Check sources",
  projectName: "Research",
  parentSessionId: "parent",
};
const owners = { projectId: "p1", parentSessionId: "parent" };

function renderPanel() {
  const events = captureEventSources();
  const location = memoryLocation({ path: "/", record: true });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={events.factory}>
        <LiveSync />
        <Router hook={location.hook}>
          <NeedsAttentionPanel />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...view, ...events, location };
}

describe("NeedsAttentionPanel", () => {
  it("shows loading rather than an empty state until the read completes", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/sessions/waiting", async () => {
        await pending;
        return HttpResponse.json({ sessions: [] });
      }),
    );
    renderPanel();
    expect(screen.getByRole("status").textContent).toContain("Checking for permissions");
    expect(screen.queryByText("Nothing needs your attention.")).toBeNull();
    release?.();
    expect(await screen.findByText("Nothing needs your attention.")).toBeDefined();
  });

  it("links directly to a worker's approval surface and names its project", async () => {
    server.use(
      http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions: [session] })),
    );
    const { location } = renderPanel();
    const link = await screen.findByRole("link", { name: "Check sources" });
    expect(screen.getByText("Research")).toBeDefined();
    expect(screen.getByText("Worker")).toBeDefined();
    await userEvent.click(link);
    expect(location.history).toEqual(["/", "/sessions/worker"]);
  });

  it("offers retry on an initial read failure without claiming the list is empty", async () => {
    server.use(http.get("*/api/sessions/waiting", () => new HttpResponse(null, { status: 500 })));
    renderPanel();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText("Nothing needs your attention.")).toBeNull();
    server.use(http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions: [] })));
    await userEvent.click(retry);
    expect(await screen.findByText("Nothing needs your attention.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("updates two independent tabs from SSE when a session pauses and is actioned elsewhere", async () => {
    let sessions: WaitingSession[] = [];
    server.use(http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions })));
    const first = renderPanel();
    const second = renderPanel();
    const tabs = [first, second];
    await waitFor(() => {
      for (const tab of tabs)
        expect(within(tab.container).getByText("Nothing needs your attention.")).toBeDefined();
    });

    sessions = [session];
    act(() => {
      for (const tab of tabs)
        tab.sources[0]?.emit({
          type: "session.updated",
          id: "worker",
          status: "waiting",
          ...owners,
        });
    });
    await waitFor(() => {
      for (const tab of tabs)
        expect(within(tab.container).getByRole("link", { name: "Check sources" })).toBeDefined();
    });

    sessions = [];
    act(() => {
      for (const tab of tabs)
        tab.sources[0]?.emit({
          type: "session.updated",
          id: "worker",
          status: "running",
          ...owners,
        });
    });
    await waitFor(() => {
      for (const tab of tabs) {
        expect(within(tab.container).queryByRole("link", { name: "Check sources" })).toBeNull();
        expect(within(tab.container).getByText("Nothing needs your attention.")).toBeDefined();
      }
    });
  });

  for (const event of [
    { type: "session.finished", id: "worker", status: "cancelled", ...owners },
    { type: "session.deleted", id: "worker", ...owners },
  ] satisfies KiriEvent[]) {
    it(`removes a waiting worker after ${event.type}`, async () => {
      let sessions = [session];
      server.use(http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions })));
      const { sources } = renderPanel();
      await screen.findByRole("link", { name: "Check sources" });
      sessions = [];
      act(() => sources[0]?.emit(event));
      expect(await screen.findByText("Nothing needs your attention.")).toBeDefined();
      expect(screen.queryByRole("link", { name: "Check sources" })).toBeNull();
    });
  }

  it("refetches project names on rename and recovers missed resolutions on reconnect", async () => {
    let sessions = [session];
    server.use(http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions })));
    const { sources } = renderPanel();
    await screen.findByRole("link", { name: "Check sources" });
    act(() => sources[0]?.triggerOpen());
    sessions = [{ ...session, projectName: "Sources" }];
    act(() => sources[0]?.emit({ type: "project.updated", id: "p1" }));
    expect(await screen.findByText("Sources")).toBeDefined();
    sessions = [];
    act(() => sources[0]?.triggerOpen());
    expect(await screen.findByText("Nothing needs your attention.")).toBeDefined();
  });

  it("keeps the last list with a warning if an SSE-triggered read fails", async () => {
    server.use(
      http.get("*/api/sessions/waiting", () => HttpResponse.json({ sessions: [session] })),
    );
    const { sources } = renderPanel();
    await screen.findByRole("link", { name: "Check sources" });
    server.use(http.get("*/api/sessions/waiting", () => new HttpResponse(null, { status: 500 })));
    act(() =>
      sources[0]?.emit({ type: "session.updated", id: "worker", status: "running", ...owners }),
    );
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("link", { name: "Check sources" })).toBeDefined();
    expect(screen.queryByText("Nothing needs your attention.")).toBeNull();
  });
});
