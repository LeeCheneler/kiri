import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { cancelSession, createSession, fetchSessionsPage } from "../api.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "./query-client.ts";
import {
  useModels,
  usePatchSessionInbox,
  useRefreshSessionDetail,
  useSession,
  useSessionsFeed,
  useSessionsLive,
  useTruncateSessionDetail,
} from "./sessions.ts";

const sessionRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  status: "idle",
  model: "anthropic:claude",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  ...overrides,
});

const renderProbe = (ui: ReactNode) => {
  const { factory, sources } = captureEventSources();
  const queryClient = createQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...result, sources, queryClient };
};

const ModelsProbe = () => {
  const { data } = useModels();
  return <p>{data ? data.models.map((m) => m.id).join(",") : "loading"}</p>;
};

// Probe whose rendered text is the session's model, kept live by useSessionsLive.
const SessionProbe = ({ id }: { id: string }) => {
  useSessionsLive();
  const { data } = useSession(id);
  return <p>{data ? data.session.model : "loading"}</p>;
};

// Probe whose rendered text is the cached transcript's message ids, with a
// button that truncates the cached detail from a given message.
const TruncateProbe = ({ id, messageId }: { id: string; messageId: string }) => {
  const { data } = useSession(id);
  const truncate = useTruncateSessionDetail(id);
  return (
    <div>
      <p>{data ? data.messages.map((m) => m.id).join(",") || "empty" : "loading"}</p>
      <button type="button" onClick={() => truncate(messageId, 1)}>
        truncate
      </button>
    </div>
  );
};

const FeedProbe = () => {
  useSessionsLive();
  const { data } = useSessionsFeed();
  return <p>{data ? data.map((s) => s.id).join(",") || "empty" : "loading"}</p>;
};

// Serve a session whose model encodes the fetch count, so a refetch is
// observable as the rendered model advancing m-1 → m-2 → …
const serveCountingSession = () => {
  let calls = 0;
  server.use(
    http.get("*/api/sessions/:id", () => {
      calls++;
      return HttpResponse.json({
        transcriptRevision: 0,
        session: sessionRow("s1", { model: `m-${calls}` }),
        messages: [],
      });
    }),
  );
};

// Serve a session list whose only row's id encodes the fetch count.
const serveCountingFeed = () => {
  let calls = 0;
  server.use(
    http.get("*/api/sessions", () => {
      calls++;
      return HttpResponse.json({ sessions: [sessionRow(`s-${calls}`)], nextCursor: null });
    }),
  );
};

describe("sessions state", () => {
  it("adds a queued message to the cached inbox once, even if a refetch already brought it", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({
          transcriptRevision: 1,
          session: sessionRow("s1"),
          messages: [],
          inbox: [],
        }),
      ),
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => ({ session: useSession("s1"), inbox: usePatchSessionInbox("s1") }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.session.data).toBeDefined());
    const item = {
      id: "q1",
      source: "user" as const,
      text: "also check the docs",
      fromSessionId: null,
      createdAt: "2026-09-19T00:00:00.000Z",
    };

    act(() => {
      result.current.inbox.append(item);
      result.current.inbox.append(item);
    });

    await waitFor(() => expect(result.current.session.data?.inbox).toEqual([item]));
  });

  it("joins a newer lifecycle read when it replaces the post-stream refresh", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    server.use(
      http.get("*/api/sessions/:id", async () => {
        const revision = ++reads;
        if (revision === 2) await blocked;
        return HttpResponse.json({
          transcriptRevision: revision,
          session: sessionRow("s1"),
          messages: [],
        });
      }),
    );
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => {
        const session = useSession("s1");
        const refresh = useRefreshSessionDetail("s1");
        return { session, refresh };
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.session.data?.transcriptRevision).toBe(1));
    const refreshing = result.current.refresh();
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      expect((await refreshing).transcriptRevision).toBe(3);
      release();
    });
  });

  it("keeps a committed truncation when an older detail read arrives afterwards", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    server.use(
      http.get("*/api/sessions/:id", async () => {
        reads += 1;
        if (reads > 1) await blocked;
        return HttpResponse.json({
          transcriptRevision: 0,
          session: sessionRow("s1"),
          messages: [
            { id: "m1", role: "user", parts: [] },
            { id: "m2", role: "assistant", parts: [] },
          ],
        });
      }),
    );
    const { queryClient } = renderProbe(<TruncateProbe id="s1" messageId="m2" />);
    await screen.findByText("m1,m2");
    const reading = queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
    await waitFor(() => expect(reads).toBe(2));
    act(() => screen.getByRole("button", { name: "truncate" }).click());
    await screen.findByText("m1");
    await act(async () => {
      release();
      await reading;
    });
    expect(screen.queryByText("m1,m2") === null).toBe(true);
    expect(queryClient.getQueryData(["session", "s1"])).toMatchObject({ transcriptRevision: 1 });
  });

  it("ignores a truncation response older than the cached snapshot", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({
          transcriptRevision: 2,
          session: sessionRow("s1"),
          messages: [
            { id: "m1", role: "user", parts: [] },
            { id: "m2", role: "assistant", parts: [] },
          ],
        }),
      ),
    );
    const { queryClient } = renderProbe(<TruncateProbe id="s1" messageId="m2" />);
    await screen.findByText("m1,m2");
    act(() => screen.getByRole("button", { name: "truncate" }).click());
    expect(queryClient.getQueryData(["session", "s1"])).toMatchObject({ transcriptRevision: 2 });
    expect(screen.queryByText("m1,m2") !== null).toBe(true);
  });

  it("fetches the available models", async () => {
    server.use(
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic" }],
          failures: [],
        }),
      ),
    );
    renderProbe(<ModelsProbe />);
    expect(await screen.findByText("anthropic:claude")).toBeDefined();
  });

  it("fetches and exposes a session's detail", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({ session: sessionRow("s1", { model: "openai:gpt" }), messages: [] }),
      ),
    );
    renderProbe(<SessionProbe id="s1" />);
    expect(await screen.findByText("openai:gpt")).toBeDefined();
  });

  it("refetches a session on its own lifecycle events", async () => {
    serveCountingSession();
    const { sources } = renderProbe(<SessionProbe id="s1" />);
    await screen.findByText("m-1");

    act(() => sources[0]?.emit({ type: "session.updated", id: "s1", status: "running" }));
    await screen.findByText("m-2");

    act(() => sources[0]?.emit({ type: "session.message.added", sessionId: "s1" }));
    await screen.findByText("m-3");

    act(() => sources[0]?.emit({ type: "session.finished", id: "s1", status: "failed" }));
    await screen.findByText("m-4");
  });

  it("does not refetch a session on another session's events", async () => {
    serveCountingSession();
    const { sources } = renderProbe(<SessionProbe id="s1" />);
    await screen.findByText("m-1");

    act(() => sources[0]?.emit({ type: "session.updated", id: "other", status: "running" }));
    // The detail query for s1 is untouched; only the keyed "other" query and the
    // feed (not mounted here) were invalidated, so the model stays m-1.
    await act(() => Promise.resolve());
    expect(screen.getByText("m-1")).toBeDefined();
  });

  it("re-syncs a session on event-stream reconnect", async () => {
    serveCountingSession();
    const { sources } = renderProbe(<SessionProbe id="s1" />);
    await screen.findByText("m-1");

    act(() => {
      // First open is the initial connect (silent); the second is a reconnect.
      sources[0]?.triggerOpen();
      sources[0]?.triggerOpen();
    });
    await screen.findByText("m-2");
  });

  it("truncates the cached detail from a message", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({
          transcriptRevision: 0,
          session: sessionRow("s1"),
          messages: [
            { id: "m1", role: "user", parts: [] },
            { id: "m2", role: "assistant", parts: [] },
            { id: "m3", role: "user", parts: [] },
          ],
        }),
      ),
    );
    renderProbe(<TruncateProbe id="s1" messageId="m2" />);
    await screen.findByText("m1,m2,m3");

    act(() => screen.getByRole("button", { name: "truncate" }).click());

    // The message and everything after it leave the cached transcript.
    expect(await screen.findByText("m1")).toBeDefined();
  });

  it("leaves the cached detail alone for an unknown message", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({
          transcriptRevision: 0,
          session: sessionRow("s1"),
          messages: [{ id: "m1", role: "user", parts: [] }],
        }),
      ),
    );
    renderProbe(<TruncateProbe id="s1" messageId="ghost" />);
    await screen.findByText("m1");

    act(() => screen.getByRole("button", { name: "truncate" }).click());

    expect(screen.getByText("m1")).toBeDefined();
  });

  it("fetches the session feed newest-first", async () => {
    server.use(
      http.get("*/api/sessions", () =>
        HttpResponse.json({ sessions: [sessionRow("s2"), sessionRow("s1")], nextCursor: null }),
      ),
    );
    renderProbe(<FeedProbe />);
    expect(await screen.findByText("s2,s1")).toBeDefined();
  });

  it("refetches the feed as sessions start", async () => {
    serveCountingFeed();
    const { sources } = renderProbe(<FeedProbe />);
    await screen.findByText("s-1");

    act(() => sources[0]?.emit({ type: "session.started", id: "new" }));
    await screen.findByText("s-2");
  });

  it("refetches the feed when a session is deleted", async () => {
    serveCountingFeed();
    const { sources } = renderProbe(<FeedProbe />);
    await screen.findByText("s-1");

    act(() => sources[0]?.emit({ type: "session.deleted", id: "s-1" }));
    await screen.findByText("s-2");
  });

  it("requests a cursored page of sessions", async () => {
    server.use(
      http.get("*/api/sessions", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor") ?? "none";
        return HttpResponse.json({ sessions: [sessionRow(cursor)], nextCursor: null });
      }),
    );
    const page = await fetchSessionsPage({ cursor: "c1" });
    expect(page.sessions[0]?.id).toBe("c1");
  });

  it("creates a session against a model", async () => {
    server.use(
      http.post("*/api/sessions", () =>
        HttpResponse.json({ session: sessionRow("s1") }, { status: 201 }),
      ),
    );
    const { session } = await createSession("anthropic:claude");
    expect(session.id).toBe("s1");
  });

  it("cancels a session's in-flight turn", async () => {
    server.use(
      http.post("*/api/sessions/:id/cancel", () =>
        HttpResponse.json({ sessionId: "s1" }, { status: 202 }),
      ),
    );
    expect(await cancelSession("s1")).toEqual({ sessionId: "s1" });
  });
});
