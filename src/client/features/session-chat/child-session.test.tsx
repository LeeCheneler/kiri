import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { Session } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ChatMessage } from "./chat-message.tsx";
import { ChildSession } from "./child-session.tsx";
import type { ToolPart } from "./tool-invocation.tsx";

const delegatePart = (overrides: Record<string, unknown> = {}): ToolPart =>
  ({
    type: "tool-delegate",
    toolCallId: "c1",
    state: "input-available",
    input: { title: "Pelican census", task: "Research pelicans" },
    ...overrides,
  }) as ToolPart;

const child = (status: Session["status"]): Session => ({
  id: "child-1",
  status,
  projectId: null,
  model: "anthropic:claude",
  imageModel: null,
  effort: "medium" as const,
  cwd: null,
  title: null,
  parentSessionId: "parent-1",
  parentToolCallId: "c1",
  startedAt: "2026-07-17T10:00:00.000Z",
  finishedAt: null,
  error: null,
});

const childMessage = (id: string, role: "user" | "assistant", parts: unknown[]) => ({
  id,
  sessionId: "child-1",
  index: 0,
  role,
  parts,
  contextTokens: null,
  createdAt: "2026-07-17T10:00:00.000Z",
});

const withChildren = (children: Session[]) =>
  server.use(http.get("*/api/sessions/parent-1/children", () => HttpResponse.json({ children })));

const withChildDetail = (status: Session["status"], messages: unknown[]) =>
  server.use(
    http.get("*/api/sessions/child-1", () =>
      HttpResponse.json({ session: child(status), messages }),
    ),
  );

const renderBox = (part = delegatePart()) => {
  const queryClient = createQueryClient();
  const { hook } = memoryLocation({ path: "/sessions/parent-1" });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <ChildSession part={part} parentSessionId="parent-1" />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<ChildSession>", () => {
  it("renders just the title and status until the child row exists", async () => {
    withChildren([]);
    renderBox();

    expect(await screen.findByText("Pelican census")).toBeDefined();
    expect(screen.getByText(/working/i)).toBeDefined();
    // The brief belongs to the expanded view, not the collapsed row.
    expect(screen.queryByText("Research pelicans")).toBeNull();
    // No child yet means nothing to expand into.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to the task brief when the call has no title", async () => {
    withChildren([]);
    renderBox(delegatePart({ input: { task: "Research pelicans" } }));

    expect(await screen.findByText("Research pelicans")).toBeDefined();
  });

  it("shows the child's live status once the lookup finds it", async () => {
    withChildren([child("running")]);
    renderBox();

    expect(await screen.findByRole("button", { name: /delegate/i })).toBeDefined();
    expect(screen.getByText("Pelican census")).toBeDefined();
    expect(screen.getByText(/working/i)).toBeDefined();
  });

  it("expands to the worker's transcript with a link to its page", async () => {
    withChildren([child("idle")]);
    withChildDetail("idle", [
      childMessage("m1", "user", [{ type: "text", text: "Research pelicans" }]),
      childMessage("m2", "assistant", [
        { type: "step-start" },
        {
          type: "tool-tavily__search",
          toolCallId: "t1",
          state: "output-available",
          input: { query: "pelican population" },
          output: { hits: 3 },
        },
        { type: "text", text: "Pelicans are thriving." },
      ]),
    ]);
    renderBox(delegatePart({ state: "output-available", output: "Pelicans are thriving." }));

    await userEvent.click(await screen.findByRole("button", { name: /delegate/i }));

    // The worker's inner tool call and report render like any transcript,
    // led by the task brief the collapsed row no longer shows; the settled
    // child reads ok, and there is nothing left to cancel.
    expect(await screen.findByText("Pelicans are thriving.")).toBeDefined();
    expect(screen.getByText("Research pelicans")).toBeDefined();
    expect(screen.getByText("pelican population")).toBeDefined();
    expect(screen.getAllByText(/^ok$/i).length).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: "Open session" });
    expect(link.getAttribute("href")).toBe("/sessions/child-1");
    expect(screen.queryByRole("button", { name: "Cancel task" })).toBeNull();
  });

  it("renders a worker's in-flight shell command as the usual collapsible block", async () => {
    withChildren([child("running")]);
    withChildDetail("running", [
      childMessage("m1", "user", [{ type: "text", text: "Research pelicans" }]),
      childMessage("m2", "assistant", [
        {
          type: "tool-run_command",
          toolCallId: "t1",
          state: "input-available",
          input: { command: "bun test" },
        },
      ]),
    ]);
    renderBox();

    await userEvent.click(await screen.findByRole("button", { name: /delegate/i }));

    // The worker's executing command is a normal collapsed tool row that
    // expands to its (so far empty) live panel.
    await userEvent.click(await screen.findByRole("button", { name: /run command/i }));
    expect(await screen.findByText("Running…")).toBeDefined();
    expect(screen.getAllByText("bun test").length).toBeGreaterThan(0);
  });

  it("surfaces a transcript that fails to load", async () => {
    withChildren([child("idle")]);
    server.use(http.get("*/api/sessions/child-1", () => new HttpResponse(null, { status: 404 })));
    renderBox();

    await userEvent.click(await screen.findByRole("button", { name: /delegate/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/failed to load the delegated task/i)).toBeDefined();
  });

  it("renders from an assistant message when the transcript supplies the session", async () => {
    withChildren([child("running")]);
    const queryClient = createQueryClient();
    const { hook } = memoryLocation({ path: "/sessions/parent-1" });
    render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <ChatMessage
            message={
              {
                id: "m1",
                role: "assistant",
                parts: [delegatePart()],
              } as Parameters<typeof ChatMessage>[0]["message"]
            }
            busy={false}
            sessionId="parent-1"
            onResubmit={() => {}}
            onDelete={() => {}}
          />
        </Router>
      </QueryClientProvider>,
    );

    // The box (not the plain block): its summary carries the title and the
    // child's live status from the lookup.
    expect(await screen.findByRole("button", { name: /delegate/i })).toBeDefined();
    expect(screen.getByText("Pelican census")).toBeDefined();
    expect(screen.getByText(/working/i)).toBeDefined();
  });

  it("offers cancel while the child runs, aborting just the delegated task", async () => {
    let cancelled = false;
    withChildren([child("running")]);
    withChildDetail("running", [
      childMessage("m1", "user", [{ type: "text", text: "Research pelicans" }]),
    ]);
    server.use(
      http.post("*/api/sessions/child-1/cancel", () => {
        cancelled = true;
        return HttpResponse.json({ sessionId: "child-1" }, { status: 202 });
      }),
    );
    renderBox();

    await userEvent.click(await screen.findByRole("button", { name: /delegate/i }));

    expect(await screen.findByText("The worker hasn't replied yet.")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    await waitFor(() => expect(cancelled).toBe(true));
  });
});
