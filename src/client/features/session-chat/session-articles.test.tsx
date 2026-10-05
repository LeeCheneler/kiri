import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../../tests/setup/flush-async.ts";
import { server } from "../../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../../events/live.tsx";
import { useLiveInvalidation } from "../../state/live-sync.tsx";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionArticles } from "./session-articles.tsx";

const SESSION_ID = "abc12345-0000-0000-0000-000000000000";
const Live = () => {
  useLiveInvalidation();
  return null;
};
const summary = (slug: string, heading: string | null, day = 1) => ({
  slug,
  name: "Notes",
  heading,
  createdAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  lastTouchedAt: `2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`,
});
const serveSession = (projectId: string | null = null) =>
  server.use(
    http.get("*/api/sessions/:id", ({ params }) =>
      HttpResponse.json({
        session: {
          id: params.id,
          status: "idle",
          model: "anthropic:claude",
          projectId,
        },
        messages: [],
      }),
    ),
  );
const renderPanel = (compact = false) => {
  const { factory, sources } = captureEventSources();
  const { hook } = memoryLocation({ path: `/sessions/${SESSION_ID}` });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Live />
        <Router hook={hook}>
          <SessionArticles id={SESSION_ID} compact={compact} />
        </Router>
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...view, sources };
};

describe("<SessionArticles>", () => {
  it.each([null, "p1"])(
    "hides a session with no article writes (project %s)",
    async (projectId) => {
      serveSession(projectId);
      let loaded = false;
      server.use(
        http.get("*/api/sessions/:id/article-activity", () => {
          loaded = true;
          return HttpResponse.json({ articles: [] });
        }),
      );
      const { container } = renderPanel();
      await waitFor(() => expect(loaded).toBe(true));
      await flushAsync();
      expect(container.innerHTML).toBe("");
    },
  );

  it("shows every session article without truncation, linking standalone ownership", async () => {
    serveSession();
    server.use(
      http.get("*/api/sessions/:id/article-activity", () =>
        HttpResponse.json({
          articles: [
            { ...summary("old", "Old research", 1), lastTouchedAt: "2026-03-01T00:00:00.000Z" },
            summary("new", "Newest research", 4),
            summary("middle", "Middle research", 3),
            summary("scratch", null, 2),
          ],
        }),
      ),
    );
    renderPanel();
    await screen.findByRole("link", { name: "Newest research" });
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Old research" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Notes" }).getAttribute("href")).toBe(
      `/sessions/${SESSION_ID}/articles/scratch`,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("links touched project articles without fetching the project library", async () => {
    serveSession("p1");
    let libraryFetches = 0;
    server.use(
      http.get("*/api/sessions/:id/article-activity", () =>
        HttpResponse.json({ articles: [summary("touched", "Session notes")] }),
      ),
      http.get("*/api/projects/:id/articles", () => {
        libraryFetches++;
        return HttpResponse.json({
          articles: [summary("other", "Unrelated notes")],
          nextCursor: null,
        });
      }),
    );
    renderPanel();
    expect((await screen.findByRole("link", { name: "Session notes" })).getAttribute("href")).toBe(
      "/projects/p1/articles/touched",
    );
    expect(screen.queryByRole("link", { name: "Unrelated notes" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(libraryFetches).toBe(0);
  });

  it("opens the same list on mobile and supports Escape dismissal", async () => {
    serveSession();
    server.use(
      http.get("*/api/sessions/:id/article-activity", () =>
        HttpResponse.json({ articles: [summary("one", "One")] }),
      ),
    );
    renderPanel(true);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Articles (1)" }));
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "One" })).toBeDefined();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps an open drawer dismissible when its last article is deleted live", async () => {
    serveSession();
    let deleted = false;
    server.use(
      http.get("*/api/sessions/:id/article-activity", () =>
        HttpResponse.json({ articles: deleted ? [] : [summary("only", "Only article")] }),
      ),
    );
    const { sources } = renderPanel(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Articles (1)" }));
    deleted = true;
    act(() => sources[0]?.emit({ type: "article.deleted", sessionId: SESSION_ID, slug: "only" }));
    expect(
      await within(screen.getByRole("dialog")).findByText("No session articles remain."),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("appears after its first write, refreshes edits, and hides after deletion", async () => {
    serveSession("p1");
    let articles: ReturnType<typeof summary>[] = [];
    let loaded = false;
    server.use(
      http.get("*/api/sessions/:id/article-activity", () => {
        loaded = true;
        return HttpResponse.json({ articles });
      }),
    );
    const { sources, container } = renderPanel();
    await waitFor(() => expect(loaded).toBe(true));
    act(() =>
      sources[0]?.emit({
        type: "article.written",
        sessionId: "worker",
        projectId: "p1",
        slug: "other",
      }),
    );
    await flushAsync();
    expect(container.innerHTML).toBe("");

    articles = [summary("notes", "Original notes")];
    act(() =>
      sources[0]?.emit({
        type: "article.written",
        sessionId: SESSION_ID,
        projectId: "p1",
        slug: "notes",
      }),
    );
    expect(await screen.findByRole("link", { name: "Original notes" })).toBeDefined();

    articles = [summary("notes", "Edited notes")];
    act(() =>
      sources[0]?.emit({
        type: "article.written",
        sessionId: SESSION_ID,
        projectId: "p1",
        slug: "notes",
      }),
    );
    expect(await screen.findByRole("link", { name: "Edited notes" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Original notes" })).toBeNull();

    articles = [];
    act(() => sources[0]?.emit({ type: "article.deleted", projectId: "p1", slug: "notes" }));
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
});
