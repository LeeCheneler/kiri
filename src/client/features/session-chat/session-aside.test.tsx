import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionAside } from "./session-aside.tsx";

const sessionDetail = (
  overrides: Record<string, unknown> = {},
  parent: { id: string; label: string } | null = null,
) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    effort: "medium",
    title: null,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    ...overrides,
  },
  messages: [],
  parent,
});

const renderAside = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

// Open the rename dialog from the rail's edit action and hand back its field.
const openRename = async (): Promise<HTMLInputElement> => {
  await userEvent.click(await screen.findByRole("button", { name: /edit title/i }));
  return within(screen.getByRole("dialog", { name: /rename session/i })).getByLabelText(
    /title/i,
  ) as HTMLInputElement;
};

describe("<SessionAside>", () => {
  it("shows the stored title read-only, with the rename action under it", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" })),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText("Postgres upgrade plan")).toBeDefined();
    expect(screen.getByRole("button", { name: /edit title/i })).toBeDefined();
    // Read-only: no title field until the rename dialog is opened.
    expect(screen.queryByLabelText(/title/i)).toBeNull();
  });

  it("stands the short id in for an untitled session", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("button", { name: /edit title/i });
    // The session fixture's id is "s1"; its 8-char prefix is the id itself.
    expect(screen.getByText("s1")).toBeDefined();
    // A top-level session has no parent to link back to.
    expect(screen.queryByText("Parent")).toBeNull();
  });

  it("links a delegated worker back to its parent", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail({ parentSessionId: "parent-1" }, { id: "parent-1", label: "Bird surveys" }),
        ),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    const link = await screen.findByRole("link", { name: "Bird surveys" });
    expect(link.getAttribute("href")).toBe("/sessions/parent-1");
    expect(screen.getByText("Parent")).toBeDefined();
  });

  it("renames the session from the dialog, committed with Enter", async () => {
    let patched: { title?: string | null } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { title?: string | null };
        return HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const field = await openRename();
    await userEvent.type(field, "  Postgres upgrade plan  {Enter}");

    // Committed trimmed; the dialog closes and the rail shows the PATCH
    // response's title.
    await waitFor(() => expect(patched.title).toBe("Postgres upgrade plan"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByText("Postgres upgrade plan")).toBeDefined());
  });

  it("clears the title when a blanked field is saved", async () => {
    let patched: { title?: string | null } = { title: "unset" };
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" })),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { title?: string | null };
        return HttpResponse.json(sessionDetail({ title: null }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const field = await openRename();
    expect(field.value).toBe("Postgres upgrade plan");
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(patched.title).toBeNull());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("does not PATCH an unchanged title on save", async () => {
    let patchCalls = 0;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" })),
      ),
      http.patch("*/api/sessions/:id", () => {
        patchCalls += 1;
        return HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const field = await openRename();
    // Editing whitespace only still saves to the same stored title — the
    // dialog closes without PATCHing.
    await userEvent.type(field, "  ");
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patchCalls).toBe(0);
  });

  it("abandons the rename when the dialog is cancelled", async () => {
    let patchCalls = 0;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ title: "Postgres upgrade plan" })),
      ),
      http.patch("*/api/sessions/:id", () => {
        patchCalls += 1;
        return HttpResponse.json(sessionDetail({ title: "Renamed anyway" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const field = await openRename();
    await userEvent.type(field, " with edits nobody keeps");
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patchCalls).toBe(0);
    expect(screen.getByText("Postgres upgrade plan")).toBeDefined();
  });

  it("surfaces a provider whose model listing failed", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
          failures: [{ provider: "openai", reason: "401 Unauthorized" }],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText(/openai models unavailable/i)).toBeDefined();
    expect(screen.getByText("401 Unauthorized")).toBeDefined();
  });

  it("shows the session's working directory", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ cwd: "/srv/notes/inbox" })),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText("Working directory")).toBeTruthy();
    expect(screen.getByText("/srv/notes/inbox")).toBeTruthy();
  });

  it("omits the working directory block when the session has none", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("button", { name: /edit title/i });
    expect(screen.queryByText(/working directory/i)).toBeNull();
  });

  it("renders nothing until the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    const { container } = renderAside(<SessionAside id="s1" />);
    expect(container.firstChild).toBeNull();
  });
});
