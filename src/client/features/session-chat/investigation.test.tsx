import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ToolUIPart, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { Investigation } from "./investigation.tsx";

const investigatePart = (
  toolCallId: string,
  task: string,
  state = "input-available",
  output?: unknown,
): ToolUIPart =>
  ({
    type: "tool-investigate",
    toolCallId,
    state,
    input: { task },
    ...(output !== undefined ? { output } : {}),
  }) as unknown as ToolUIPart;

const childSession = (overrides: Record<string, unknown> = {}) => ({
  id: "child",
  status: "idle",
  model: "anthropic:claude",
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  persona: null,
  parentSessionId: "parent",
  parentToolCallId: "inv1",
  kind: "investigation",
  ...overrides,
});

const childMessage = (id: string, role: "user" | "assistant", parts: unknown[]) => ({
  id,
  sessionId: "child",
  index: 0,
  role,
  parts,
  contextTokens: null,
  createdAt: "2026-05-09T12:00:00.000Z",
});

const assistantReply = (text: string) =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "a1" });
        writer.write({ type: "text-delta", id: "a1", delta: text });
        writer.write({ type: "text-end", id: "a1" });
      },
    }),
  });

// get-or-create the child, returning a fixed child row.
const getOrCreate = (status = 201) =>
  http.post("*/api/sessions", () => HttpResponse.json({ session: childSession() }, { status }));

// the child's detail (its persisted transcript).
const childDetail = (messages: unknown[], sessionOverrides: Record<string, unknown> = {}) =>
  http.get("*/api/sessions/child", () =>
    HttpResponse.json({ session: childSession(sessionOverrides), messages }),
  );

const renderBox = (part: ToolUIPart, onReport: (toolCallId: string, report: string) => void) => {
  const queryClient = createQueryClient();
  const { hook } = memoryLocation({ path: "/sessions/parent" });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <Investigation part={part} parentSessionId="parent" onReport={onReport} />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<Investigation>", () => {
  it("creates the child, runs the task, and reports the result back", async () => {
    server.use(
      getOrCreate(),
      childDetail([]),
      http.post("*/api/sessions/child/messages", () => assistantReply("X wins on price.")),
    );
    const reports: [string, string][] = [];

    renderBox(investigatePart("inv1", "compare X and Y"), (id, report) =>
      reports.push([id, report]),
    );

    await waitFor(() => expect(reports).toEqual([["inv1", "X wins on price."]]));
    // Collapsed by default — expanding reveals the worker's report inline.
    expect(screen.queryByText("X wins on price.")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: /investigation/i }));
    expect(screen.getByText("X wins on price.")).toBeDefined();
  });

  it("re-attaches a completed child on reload without re-running, and reports its result", async () => {
    let started = false;
    server.use(
      getOrCreate(200),
      childDetail([
        childMessage("u1", "user", [{ type: "text", text: "compare" }]),
        childMessage("a1", "assistant", [
          {
            type: "tool-tavily__search",
            toolCallId: "t1",
            state: "output-available",
            input: { query: "x" },
            output: { hits: 2 },
          },
          { type: "text", text: "X wins." },
        ]),
      ]),
      http.post("*/api/sessions/child/messages", () => {
        started = true;
        return assistantReply("should not run");
      }),
    );
    const reports: [string, string][] = [];

    renderBox(investigatePart("inv1", "compare"), (id, report) => reports.push([id, report]));

    await waitFor(() => expect(reports).toEqual([["inv1", "X wins."]]));
    // The child already had its turn — the box must not start another.
    expect(started).toBe(false);
  });

  it("renders a finished investigation without reporting again", async () => {
    server.use(
      getOrCreate(200),
      childDetail([
        childMessage("u1", "user", [{ type: "text", text: "compare" }]),
        childMessage("a1", "assistant", [{ type: "text", text: "X wins." }]),
      ]),
    );
    const reports: [string, string][] = [];

    renderBox(investigatePart("inv1", "compare", "output-available", "X wins."), (id, report) =>
      reports.push([id, report]),
    );

    // The finished investigation still renders (its task in the summary) but
    // doesn't report again.
    await waitFor(() => expect(screen.getByText("compare")).toBeDefined());
    expect(reports).toEqual([]);
  });

  it("reports a note when the investigation fails", async () => {
    server.use(
      getOrCreate(200),
      childDetail([childMessage("u1", "user", [{ type: "text", text: "compare" }])], {
        status: "failed",
      }),
    );
    const reports: [string, string][] = [];

    renderBox(investigatePart("inv1", "compare"), (id, report) => reports.push([id, report]));

    await waitFor(() => expect(reports).toEqual([["inv1", "The investigation did not complete."]]));
  });

  it("surfaces an inner tool's approval prompt and holds, without reporting", async () => {
    server.use(
      getOrCreate(200),
      childDetail([
        childMessage("u1", "user", [{ type: "text", text: "compare" }]),
        childMessage("a1", "assistant", [
          {
            type: "tool-tavily__search",
            toolCallId: "t1",
            state: "approval-requested",
            input: { query: "x" },
            approval: { id: "ap1" },
          },
        ]),
      ]),
    );
    const reports: [string, string][] = [];

    renderBox(investigatePart("inv1", "compare"), (id, report) => reports.push([id, report]));

    await waitFor(() => expect(screen.getByRole("button", { name: "Allow" })).toBeDefined());
    expect(reports).toEqual([]);
  });
});
