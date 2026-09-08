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
    parentSessionId: null,
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
  it("moves into the selected project and updates the page without losing its draft", async () => {
    serveSession();
    localStorage.setItem("kiri:session-draft:s1", "Unsent draft");
    let moved: unknown;
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: [{ id: "p1", name: "Research" }] }),
      ),
      http.post("*/api/sessions/:id/move", async ({ request }) => {
        moved = await request.json();
        return HttpResponse.json({ session: sessionDetail("idle", "p1").session });
      }),
    );
    const { history } = renderActions();
    await userEvent.click(await screen.findByRole("button", { name: "move to project" }));
    const dialog = await screen.findByRole("dialog", { name: "Move session to project" });
    expect(
      (within(dialog).getByRole("button", { name: "move" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.selectOptions(
      await within(dialog).findByRole("combobox", { name: /Project/ }),
      "p1",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "move" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(moved).toEqual({ projectId: "p1" });
    expect(screen.queryByRole("button", { name: "move to project" })).toBeNull();
    expect(history).toEqual(["/sessions/s1"]);
    expect(localStorage.getItem("kiri:session-draft:s1")).toBe("Unsent draft");
  });

  it("keeps a failed move open for retry and allows cancellation", async () => {
    serveSession();
    let calls = 0;
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: [{ id: "p1", name: "Research" }] }),
      ),
      http.post("*/api/sessions/:id/move", () => {
        calls += 1;
        return HttpResponse.json({ error: 'Article slug "notes" conflicts.' }, { status: 409 });
      }),
    );
    renderActions();
    await userEvent.click(await screen.findByRole("button", { name: "move to project" }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /Project/ }), "p1");
    await userEvent.click(screen.getByRole("button", { name: "move" }));
    expect((await screen.findByRole("alert")).textContent).toContain('"notes" conflicts');
    expect((screen.getByRole("button", { name: "move" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).toBe(1);
  });

  it("explains when there are no projects to select", async () => {
    serveSession();
    server.use(http.get("*/api/projects", () => HttpResponse.json({ projects: [] })));
    renderActions();
    await userEvent.click(await screen.findByRole("button", { name: "move to project" }));
    expect(await screen.findByText(/Create a project from the Projects page first/)).toBeDefined();
    expect((screen.getByRole("button", { name: "move" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows project loading errors", async () => {
    serveSession();
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ error: "Unavailable" }, { status: 500 }),
      ),
    );
    renderActions();
    await userEvent.click(await screen.findByRole("button", { name: "move to project" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Unavailable");
  });

  it.each(["running", "waiting"])("disables moving a %s session", async (status) => {
    serveSession(status);
    renderActions();
    expect(
      ((await screen.findByRole("button", { name: "move to project" })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("hides the move action for sessions already in a project", async () => {
    serveSession("idle", "p1");
    renderActions();
    await deleteButton();
    expect(screen.queryByRole("button", { name: "move to project" })).toBeNull();
  });

  it("hides the move action for delegated sessions", async () => {
    const detail = sessionDetail();
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json({ ...detail, session: { ...detail.session, parentSessionId: "parent" } }),
      ),
    );
    renderActions();
    await deleteButton();
    expect(screen.queryByRole("button", { name: "move to project" })).toBeNull();
  });

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
