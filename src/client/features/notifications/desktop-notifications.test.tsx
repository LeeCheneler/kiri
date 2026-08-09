import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { type KiriEvent, LiveEventsProvider } from "../../events/live.tsx";
import { DesktopNotifications } from "./desktop-notifications.tsx";
import {
  type DesktopNotificationSpec,
  type Notifier,
  setDesktopNotificationsEnabled,
} from "./notifier.ts";

const runPayload = (id: string, workflowName: string) => ({
  run: {
    id,
    workflowName,
    status: "ok",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: "2026-05-09T12:00:01.000Z",
    error: null,
    summary: null,
    definitionSnapshot: { name: workflowName, steps: [] },
    articles: [],
    recommendations: [],
  },
  steps: [],
});

const sessionPayload = (id: string, overrides: Record<string, unknown> = {}) => ({
  session: {
    id,
    status: "idle",
    model: "anthropic:claude",
    title: "Ship checklist",
    parentSessionId: null,
    parentToolCallId: null,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    ...overrides,
  },
  messages: [],
});

const renderNotifications = (opts: { path?: string; permission?: NotificationPermission } = {}) => {
  const { factory, sources } = captureEventSources();
  const { hook, history } = memoryLocation({ path: opts.path ?? "/", record: true });
  const shown: DesktopNotificationSpec[] = [];
  const notifier: Notifier = {
    permission: () => opts.permission ?? "granted",
    requestPermission: async () => opts.permission ?? "granted",
    show: (spec) => {
      shown.push(spec);
    },
  };
  render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <DesktopNotifications notifier={notifier} />
      </LiveEventsProvider>
    </Router>,
  );
  const emit = async (event: KiriEvent) => {
    act(() => {
      (sources[0] as (typeof sources)[number]).emit(event);
    });
    await flushAsync();
  };
  return { emit, shown, history };
};

let hasFocus: ReturnType<typeof spyOn>;

beforeEach(() => {
  setDesktopNotificationsEnabled(true);
  hasFocus = spyOn(document, "hasFocus").mockReturnValue(false);
});

afterEach(() => {
  setDesktopNotificationsEnabled(false);
  hasFocus.mockRestore();
});

describe("<DesktopNotifications>", () => {
  it("notifies when a run finishes while the tab is unfocused, opening the run on click", async () => {
    server.use(http.get("*/api/runs/:id", () => HttpResponse.json(runPayload("r1", "deploy"))));
    const { emit, shown, history } = renderNotifications();
    await emit({ type: "run.finished", id: "r1", status: "ok" });
    expect(shown).toHaveLength(1);
    const spec = shown[0] as DesktopNotificationSpec;
    expect(spec.title).toBe("deploy");
    expect(spec.body).toBe("Workflow finished · ok");
    expect(spec.tag).toBe("r1");
    act(() => spec.onClick());
    expect(history).toContain("/runs/r1");
  });

  it("stays silent when the tab is focused on the finished run's page", async () => {
    hasFocus.mockReturnValue(true);
    const { emit, shown } = renderNotifications({ path: "/runs/r1" });
    await emit({ type: "run.finished", id: "r1", status: "ok" });
    expect(shown).toHaveLength(0);
  });

  it("notifies when the tab is focused on a different page", async () => {
    hasFocus.mockReturnValue(true);
    server.use(http.get("*/api/runs/:id", () => HttpResponse.json(runPayload("r1", "deploy"))));
    const { emit, shown } = renderNotifications({ path: "/workflows" });
    await emit({ type: "run.finished", id: "r1", status: "failed" });
    expect(shown).toHaveLength(1);
    expect((shown[0] as DesktopNotificationSpec).body).toBe("Workflow finished · failed");
  });

  it("stays silent when the preference is off", async () => {
    setDesktopNotificationsEnabled(false);
    const { emit, shown } = renderNotifications();
    await emit({ type: "run.finished", id: "r1", status: "ok" });
    expect(shown).toHaveLength(0);
  });

  it("stays silent without notification permission", async () => {
    const { emit, shown } = renderNotifications({ permission: "denied" });
    await emit({ type: "run.finished", id: "r1", status: "ok" });
    expect(shown).toHaveLength(0);
  });

  it("notifies when a session's turn settles to idle, opening the session on click", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionPayload("s1"))));
    const { emit, shown, history } = renderNotifications();
    await emit({ type: "session.updated", id: "s1", status: "idle" });
    expect(shown).toHaveLength(1);
    const spec = shown[0] as DesktopNotificationSpec;
    expect(spec.title).toBe("Ship checklist");
    expect(spec.body).toBe("Finished working");
    expect(spec.tag).toBe("s1");
    act(() => spec.onClick());
    expect(history).toContain("/sessions/s1");
  });

  it("ignores mid-turn session updates", async () => {
    const { emit, shown } = renderNotifications();
    await emit({ type: "session.updated", id: "s1", status: "running" });
    expect(shown).toHaveLength(0);
  });

  it("notifies a terminal session failure, falling back to a generic title when untitled", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionPayload("s1", { title: null })),
      ),
    );
    const { emit, shown } = renderNotifications();
    await emit({ type: "session.finished", id: "s1", status: "failed" });
    expect(shown).toHaveLength(1);
    const spec = shown[0] as DesktopNotificationSpec;
    expect(spec.title).toBe("Session");
    expect(spec.body).toBe("Session failed");
  });

  it("stays silent for delegate child sessions", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionPayload("s2", { parentSessionId: "s1" })),
      ),
    );
    const { emit, shown } = renderNotifications();
    await emit({ type: "session.updated", id: "s2", status: "idle" });
    expect(shown).toHaveLength(0);
  });
});
