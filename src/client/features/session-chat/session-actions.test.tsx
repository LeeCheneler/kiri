import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionActions } from "./session-actions.tsx";

const sessionDetail = (status = "idle", projectId: string | null = null) => ({
  session: {
    id: "s1",
    status,
    model: "anthropic:claude",
    projectId,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
  },
  messages: [],
});

const serveSession = (status = "idle", projectId: string | null = null) =>
  server.use(
    http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(status, projectId))),
  );

const renderActions = () => {
  const memory = memoryLocation({ path: "/sessions/s1", record: true });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <SessionActions id="s1" />
      </Router>
    </QueryClientProvider>,
  );
  return { history: memory.history };
};

const deleteButton = () => screen.findByRole("button", { name: /delete session/i });

// Opens the delete confirmation dialog and confirms it.
const confirmDelete = async () => {
  await userEvent.click(await deleteButton());
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
};

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("<SessionActions>", () => {
  it("deletes the session and returns to the list on confirm", async () => {
    let deleted = false;
    serveSession();
    server.use(
      http.delete("*/api/sessions/:id", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderActions();

    await confirmDelete();

    await waitFor(() => expect(history[history.length - 1]).toBe("/?view=sessions"));
    expect(deleted).toBe(true);
  });

  it("returns to the project page when deleting a project session", async () => {
    serveSession("idle", "p1");
    server.use(http.delete("*/api/sessions/:id", () => new HttpResponse(null, { status: 204 })));
    const { history } = renderActions();

    await confirmDelete();

    await waitFor(() => expect(history[history.length - 1]).toBe("/projects/p1"));
  });

  it("drops the session's saved draft on delete", async () => {
    localStorage.setItem("kiri:session-draft:s1", "unsent words");
    serveSession();
    server.use(http.delete("*/api/sessions/:id", () => new HttpResponse(null, { status: 204 })));
    const { history } = renderActions();

    await confirmDelete();

    await waitFor(() => expect(history[history.length - 1]).toBe("/?view=sessions"));
    expect(localStorage.getItem("kiri:session-draft:s1")).toBeNull();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    let deleted = false;
    serveSession();
    server.use(
      http.delete("*/api/sessions/:id", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderActions();

    await userEvent.click(await deleteButton());
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleted).toBe(false);
    expect(history).toEqual(["/sessions/s1"]);
  });

  it("still navigates away when the session was already deleted", async () => {
    serveSession();
    server.use(
      http.delete("*/api/sessions/:id", () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );
    const { history } = renderActions();

    await confirmDelete();

    await waitFor(() => expect(history[history.length - 1]).toBe("/?view=sessions"));
  });

  it("surfaces an error and stays put when the delete fails", async () => {
    serveSession();
    server.use(
      http.delete("*/api/sessions/:id", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    const { history } = renderActions();

    await confirmDelete();

    expect(await screen.findByText("boom")).toBeDefined();
    expect(history).toEqual(["/sessions/s1"]);
  });

  it("disables delete while a turn is in flight", async () => {
    serveSession("running");
    renderActions();

    const button = (await deleteButton()) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
