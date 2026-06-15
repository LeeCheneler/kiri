import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionChat } from "./session-chat.tsx";

const sessionDetail = (messages: unknown[] = [], overrides: Record<string, unknown> = {}) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  },
  messages,
});

const message = (id: string, role: "user" | "assistant", text: string) => ({
  id,
  sessionId: "s1",
  index: 0,
  role,
  parts: [{ type: "text", text }],
  usage: null,
  createdAt: "2026-05-09T12:00:00.000Z",
});

// A correctly-framed assistant UI-message stream, built with the SDK's own
// helpers so the wire format matches what the real turn endpoint emits.
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

// A stream that opens then never closes, so the turn stays in flight until
// it's cancelled — makes the cancel affordance deterministic.
const parkedReply = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "text-start", id: "p1" });
        return new Promise<void>(() => {});
      },
    }),
  });

const renderChat = (id = "s1") => {
  const { hook } = memoryLocation({ path: `/sessions/${id}` });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <SessionChat id={id} />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<SessionChat>", () => {
  it("shows a loading state while the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    renderChat();
    expect(screen.getByText(/loading session/i)).toBeDefined();
  });

  it("shows a not-found message for an unknown session", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json({ error: "nope" }, { status: 404 })),
    );
    renderChat("ghost");
    expect(await screen.findByText(/no session with id ghost/i)).toBeDefined();
  });

  it("shows an error message when the session fails to load", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderChat();
    expect(await screen.findByText(/failed to load session/i)).toBeDefined();
  });

  it("renders the persisted transcript", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([
            message("m1", "user", "First question"),
            message("m2", "assistant", "An answer"),
          ]),
        ),
      ),
    );
    renderChat();
    expect(await screen.findByText("First question")).toBeDefined();
    expect(screen.getByText("An answer")).toBeDefined();
  });

  it("focuses the composer on landing", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    const textbox = await screen.findByRole("textbox", { name: /message/i });
    await waitFor(() => expect(document.activeElement).toBe(textbox));
  });

  it("sends a message and streams the assistant reply", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => assistantReply("Hi back")),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello there");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("Hello there")).toBeDefined();
    expect(await screen.findByText("Hi back")).toBeDefined();
  });

  it("surfaces a turn error", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => new HttpResponse(null, { status: 500 })),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("cancels an in-flight turn", async () => {
    const user = userEvent.setup();
    let cancelled = false;
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => parkedReply()),
      http.post("*/api/sessions/:id/cancel", () => {
        cancelled = true;
        // A 409 exercises the best-effort catch — the turn may have already settled.
        return HttpResponse.json({ error: "not in flight" }, { status: 409 });
      }),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await user.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(cancelled).toBe(true);
  });

  it("sends on Enter", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => assistantReply("Hi back")),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello there");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Hello there")).toBeDefined();
    expect(await screen.findByText("Hi back")).toBeDefined();
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    // No turn was sent — the conversation is still empty.
    expect(screen.getByText(/no messages yet/i)).toBeDefined();
  });

  it("ignores Enter on an empty composer", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.click(screen.getByRole("textbox", { name: /message/i }));
    await user.keyboard("{Enter}");

    expect(screen.getByText(/no messages yet/i)).toBeDefined();
  });
});
