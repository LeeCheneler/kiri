import { beforeEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const queryClient = createQueryClient();
  const { hook } = memoryLocation({ path: `/sessions/${id}` });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Router hook={hook}>
          <SessionChat id={id} />
        </Router>
      </QueryClientProvider>,
    ),
    queryClient,
  };
};

describe("<SessionChat>", () => {
  // Composer drafts persist to local storage; isolate it between tests.
  beforeEach(() => localStorage.clear());

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
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Hello there")).toBeDefined();
    expect(await screen.findByText("Hi back")).toBeDefined();
    // The reply has content, so the turn is labelled.
    expect(screen.getByText("Assistant")).toBeDefined();
  });

  it("holds the assistant label until its reply streams", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => parkedReply()),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello");
    await user.keyboard("{Enter}");

    // The turn is in flight (the working status is up) but no token has
    // streamed, so the assistant turn isn't labelled yet — only the user's is.
    await screen.findByText(/working/i);
    expect(screen.getByText("You")).toBeDefined();
    expect(screen.queryByText("Assistant")).toBeNull();
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
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toBeDefined();
  });

  it("cancels an in-flight turn on Escape", async () => {
    const user = userEvent.setup();
    let cancelled = false;
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => parkedReply()),
      http.post("*/api/sessions/:id/cancel", () => {
        cancelled = true;
        return HttpResponse.json({ error: "not in flight" }, { status: 409 });
      }),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello");
    await user.keyboard("{Enter}");

    // Wait for the turn to go in flight, then hit Escape from the window.
    await screen.findByText(/working/i);
    expect(screen.getByText(/escape to cancel/i)).toBeDefined();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(cancelled).toBe(true));
  });

  it("reflects an in-flight turn on revisit", async () => {
    // Return to a session whose turn was started elsewhere, or left running when
    // we navigated away: the row is `running` with only the user message so far.
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "Question")], { status: "running" }),
        ),
      ),
    );
    renderChat();

    expect(await screen.findByText("Question")).toBeDefined();
    // The working cue is up even though this view isn't streaming the turn, and
    // it can still be cancelled from here.
    await screen.findByText(/working/i);
    expect(screen.getByText(/escape to cancel/i)).toBeDefined();
  });

  it("folds in a turn that finished while away", async () => {
    let detail = sessionDetail([message("m1", "user", "Question")], { status: "running" });
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const { queryClient } = renderChat();

    await screen.findByText(/working/i);

    // The turn finishes elsewhere; the row settles with the assistant reply. A
    // live event would invalidate the cached session — drive that refetch here.
    detail = sessionDetail(
      [message("m1", "user", "Question"), message("m2", "assistant", "An answer")],
      { status: "idle" },
    );
    await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });

    expect(await screen.findByText("An answer")).toBeDefined();
    await waitFor(() => expect(screen.queryByText(/working/i)).toBeNull());
  });

  it("surfaces a turn that failed while away", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "Question")], {
            status: "failed",
            error: { message: "provider exploded" },
          }),
        ),
      ),
    );
    renderChat();

    expect(await screen.findByText("Question")).toBeDefined();
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByText(/provider exploded/i)).toBeDefined();
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

  it("restores a saved draft into the composer", async () => {
    localStorage.setItem("kiri:session-draft:s1", "a half-typed question");
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    const textbox = (await screen.findByRole("textbox", {
      name: /message/i,
    })) as HTMLTextAreaElement;
    expect(textbox.value).toBe("a half-typed question");
  });

  it("persists the composer draft as you type", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "draft me");

    await waitFor(() => expect(localStorage.getItem("kiri:session-draft:s1")).toBe("draft me"));
  });

  it("clears the saved draft once the message is sent", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", () => assistantReply("ok")),
    );
    renderChat();

    await screen.findByText(/no messages yet/i);
    await user.type(screen.getByRole("textbox", { name: /message/i }), "send and forget");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(localStorage.getItem("kiri:session-draft:s1")).toBeNull());
  });

  it("uploads an image and sends it as a leading file part", async () => {
    const user = userEvent.setup();
    let body:
      | { message: { parts: { type: string; mediaType?: string; text?: string }[] } }
      | undefined;
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        body = (await request.json()) as typeof body;
        return assistantReply("a cat");
      }),
    );
    const { container } = renderChat();

    await screen.findByText(/no messages yet/i);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["img"], "shot.png", { type: "image/png" }));

    // The staged image previews in the composer before sending.
    expect(await screen.findByAltText("shot.png")).toBeDefined();

    await user.type(screen.getByRole("textbox", { name: /message/i }), "what is this?");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(body).toBeDefined());
    const parts = body?.message.parts ?? [];
    // Image leads, text follows.
    expect(parts[0]).toMatchObject({ type: "file", mediaType: "image/png" });
    expect(parts.at(-1)).toMatchObject({ type: "text", text: "what is this?" });
  });

  it("sends an image-only message with no text", async () => {
    const user = userEvent.setup();
    let body: { message: { parts: { type: string }[] } } | undefined;
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        body = (await request.json()) as typeof body;
        return assistantReply("ok");
      }),
    );
    const { container } = renderChat();

    await screen.findByText(/no messages yet/i);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["img"], "only.png", { type: "image/png" }));
    await screen.findByAltText("only.png");
    await user.click(screen.getByRole("textbox", { name: /message/i }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(body).toBeDefined());
    const parts = body?.message.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "file" });
  });

  it("stages an image pasted into the composer", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();

    const textbox = await screen.findByRole("textbox", { name: /message/i });
    fireEvent.paste(textbox, {
      clipboardData: { files: [new File(["img"], "pasted.png", { type: "image/png" })] },
    });

    expect(await screen.findByAltText("pasted.png")).toBeDefined();
  });

  it("removes a staged image", async () => {
    const user = userEvent.setup();
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    const { container } = renderChat();

    await screen.findByText(/no messages yet/i);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, new File(["img"], "drop-me.png", { type: "image/png" }));

    await screen.findByAltText("drop-me.png");
    await user.click(screen.getByRole("button", { name: /remove image/i }));

    await waitFor(() => expect(screen.queryByAltText("drop-me.png")).toBeNull());
  });

  it("nudges towards a multimodal model when an image turn fails", async () => {
    const imageMessage = {
      ...message("m1", "user", ""),
      parts: [
        {
          type: "file",
          mediaType: "image/png",
          filename: "shot.png",
          url: "data:image/png;base64,AAAA",
        },
      ],
    };
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([imageMessage], { status: "failed", error: { message: "no vision" } }),
        ),
      ),
    );
    renderChat();

    expect(await screen.findByText(/no vision/i)).toBeDefined();
    expect(screen.getByText(/switch to a multimodal model/i)).toBeDefined();
  });

  it("omits the multimodal nudge when a text-only turn fails", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "Hi")], {
            status: "failed",
            error: { message: "boom" },
          }),
        ),
      ),
    );
    renderChat();

    expect(await screen.findByText(/boom/i)).toBeDefined();
    expect(screen.queryByText(/switch to a multimodal model/i)).toBeNull();
  });
});
