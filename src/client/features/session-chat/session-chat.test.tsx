import { beforeEach, describe, expect, it } from "bun:test";
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

// A settled assistant turn reporting `inputTokens`, so the context fill is known.
const assistantWithUsage = (inputTokens: number) => ({
  ...message("m1", "assistant", "answer"),
  usage: { inputTokens, outputTokens: 0, totalTokens: inputTokens },
});

const modelsWithWindow = (contextWindow: number) =>
  http.get("*/api/models", () =>
    HttpResponse.json({
      models: [{ id: "anthropic:claude", provider: "anthropic", contextWindow }],
      failures: [],
    }),
  );

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

// A resume response: the paused tool resolves (ran, or refused), then the
// assistant's follow-up text. Resolving the call clears its approval state, just
// as the real server's continuation does, so the verdict isn't re-sent in a loop.
const resumeReply = (resolution: { output?: unknown; denied?: boolean }, text: string) =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write(
          resolution.denied
            ? { type: "tool-output-denied", toolCallId: "c1" }
            : { type: "tool-output-available", toolCallId: "c1", output: resolution.output ?? {} },
        );
        writer.write({ type: "text-start", id: "r1" });
        writer.write({ type: "text-delta", id: "r1", delta: text });
        writer.write({ type: "text-end", id: "r1" });
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

// An assistant turn paused awaiting approval for a tool call — the shape the
// transcript seeds from when a turn stopped to ask the user.
const pausedToolTranscript = () => [
  message("m1", "user", "open an issue"),
  {
    ...message("m2", "assistant", ""),
    parts: [
      {
        type: "tool-linear__create_issue",
        toolCallId: "c1",
        state: "approval-requested",
        input: { title: "Bug" },
        approval: { id: "a1" },
      },
    ],
  },
];

// A turn left running with a tool call in flight — the shape the transcript
// seeds from when a session is busy executing a tool.
const runningToolTranscript = () => [
  message("m1", "user", "search the readme"),
  {
    ...message("m2", "assistant", ""),
    parts: [
      {
        type: "tool-filesystem__search_files",
        toolCallId: "c1",
        state: "input-available",
        input: { query: "readme" },
      },
    ],
  },
];

// The tool part of a resume request's assistant message.
const sentToolPart = (body: unknown) => {
  const parts = (body as { message: { parts: { type: string }[] } }).message.parts;
  const part = parts.find((p) => p.type.startsWith("tool-"));
  return part as unknown as { state: string; approval: { approved: boolean } };
};

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

  it("warns when the conversation nears the model's context window", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantWithUsage(190000)])),
      ),
      modelsWithWindow(200000),
    );
    renderChat();

    expect(await screen.findByText(/approaching context limit/i)).toBeDefined();
  });

  it("does not warn when the context fill is well within the window", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantWithUsage(1000)])),
      ),
      modelsWithWindow(200000),
    );
    renderChat();

    await screen.findByText("answer");
    expect(screen.queryByText(/approaching context limit/i)).toBeNull();
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

  it("allows a paused tool once, sending the verdict back to resume the turn", async () => {
    const user = userEvent.setup();
    let resumeBody: unknown;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(pausedToolTranscript())),
      ),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        resumeBody = await request.json();
        return resumeReply({ output: { id: 7 } }, "Created the issue.");
      }),
    );
    renderChat();

    await user.click(await screen.findByRole("button", { name: "Allow" }));

    expect(await screen.findByText("Created the issue.")).toBeDefined();
    const toolPart = sentToolPart(resumeBody);
    expect(toolPart.state).toBe("approval-responded");
    expect(toolPart.approval.approved).toBe(true);
  });

  it("always-allows a paused tool, recording a grant before resuming", async () => {
    const user = userEvent.setup();
    let grantBody: unknown;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(pausedToolTranscript())),
      ),
      http.post("*/api/tool-grants", async ({ request }) => {
        grantBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", () =>
        resumeReply({ output: { id: 7 } }, "Created the issue."),
      ),
    );
    renderChat();

    await user.click(await screen.findByRole("button", { name: "Always allow" }));

    expect(await screen.findByText("Created the issue.")).toBeDefined();
    expect(grantBody).toEqual({ tool: "linear__create_issue" });
  });

  it("allows the call even if recording the always-allow grant fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(pausedToolTranscript())),
      ),
      http.post("*/api/tool-grants", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
      http.post("*/api/sessions/:id/messages", () =>
        resumeReply({ output: { id: 7 } }, "Created the issue."),
      ),
    );
    renderChat();

    await user.click(await screen.findByRole("button", { name: "Always allow" }));

    // The grant write failed, but the call was still allowed and the turn resumed.
    expect(await screen.findByText("Created the issue.")).toBeDefined();
  });

  it("denies a paused tool, sending the refusal back without recording a grant", async () => {
    const user = userEvent.setup();
    let grantCalled = false;
    let resumeBody: unknown;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(pausedToolTranscript())),
      ),
      http.post("*/api/tool-grants", () => {
        grantCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        resumeBody = await request.json();
        return resumeReply({ denied: true }, "Okay, I won't.");
      }),
    );
    renderChat();

    await user.click(await screen.findByRole("button", { name: "Deny" }));

    expect(await screen.findByText("Okay, I won't.")).toBeDefined();
    expect(sentToolPart(resumeBody).approval.approved).toBe(false);
    expect(grantCalled).toBe(false);
  });

  it("edits a user message, truncating the transcript and resending from it", async () => {
    const user = userEvent.setup();
    let truncatedId: string | undefined;
    let sentText: string | undefined;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([
            message("m1", "user", "First question"),
            message("m2", "assistant", "An answer"),
          ]),
        ),
      ),
      http.delete("*/api/sessions/:id/messages/:messageId", ({ params }) => {
        truncatedId = String(params.messageId);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        const body = (await request.json()) as {
          message: { parts: { type: string; text?: string }[] };
        };
        sentText = body.message.parts.find((part) => part.type === "text")?.text;
        return assistantReply("A better answer");
      }),
    );
    renderChat();

    await screen.findByText("First question");
    await user.click(screen.getByRole("button", { name: "edit" }));
    const field = screen.getByRole("textbox", { name: "Edit message" });
    await user.clear(field);
    await user.type(field, "A sharper question{Enter}");

    // The edited message truncated the transcript server-side and was resent.
    await waitFor(() => expect(truncatedId).toBe("m1"));
    await waitFor(() => expect(sentText).toBe("A sharper question"));
    // The fresh reply streams in; the dropped turn does not return.
    expect(await screen.findByText("A better answer")).toBeDefined();
    await waitFor(() => expect(screen.queryByText("An answer")).toBeNull());
    expect(screen.queryByText("First question")).toBeNull();
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

  it("cancels an in-flight tool call, marking it cancelled in the transcript", async () => {
    const user = userEvent.setup();
    let cancelled = false;
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(runningToolTranscript(), { status: "running" })),
      ),
      http.post("*/api/sessions/:id/cancel", () => {
        cancelled = true;
        return HttpResponse.json({ error: "not in flight" }, { status: 409 });
      }),
    );
    const { container } = renderChat();

    // The running tool offers a Cancel control; clicking it stops the turn and
    // flips the call to cancelled rather than leaving it on "working".
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(cancelled).toBe(true));
    await waitFor(() =>
      expect(container.querySelector('[data-status="cancelled"]')).not.toBeNull(),
    );
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

  it("snaps to the foot instantly on landing, not a smooth scroll", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([message("m1", "assistant", "Latest reply")])),
      ),
    );
    const scrollCalls: ScrollToOptions[] = [];
    const originalScrollTo = window.scrollTo;
    window.scrollTo = ((options: ScrollToOptions) => {
      scrollCalls.push(options);
    }) as typeof window.scrollTo;

    try {
      renderChat();
      await screen.findByText("Latest reply");

      // Landing jumps straight to the latest message: an instant scroll that
      // opts out of the document's smooth scroll-behavior.
      expect(scrollCalls.some((o) => o.behavior === "instant")).toBe(true);
      expect(scrollCalls.some((o) => o.behavior === "smooth")).toBe(false);
    } finally {
      window.scrollTo = originalScrollTo;
    }
  });

  it("stops following the transcript once the user scrolls up", async () => {
    let detail = sessionDetail([message("m1", "user", "Question")], { status: "running" });
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const { queryClient } = renderChat();

    await screen.findByText(/working/i);

    // happy-dom has no layout, so report the page as scrolled well above the foot
    // before firing the scroll that un-pins us.
    const metrics: Record<string, number> = { scrollTop: 0, scrollHeight: 5000, clientHeight: 800 };
    const originalDescriptors = Object.keys(metrics).map(
      (key) => [key, Object.getOwnPropertyDescriptor(document.documentElement, key)] as const,
    );
    for (const [key, value] of Object.entries(metrics)) {
      Object.defineProperty(document.documentElement, key, {
        configurable: true,
        get: () => value,
      });
    }
    const scrollCalls: ScrollToOptions[] = [];
    const originalScrollTo = window.scrollTo;
    window.scrollTo = ((options: ScrollToOptions) => {
      scrollCalls.push(options);
    }) as typeof window.scrollTo;

    try {
      window.dispatchEvent(new Event("scroll"));

      // The turn settles off-screen and folds in. Because the user scrolled up,
      // the new message must not yank the page back to the foot.
      detail = sessionDetail(
        [message("m1", "user", "Question"), message("m2", "assistant", "An answer")],
        { status: "idle" },
      );
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      await screen.findByText("An answer");

      expect(scrollCalls).toHaveLength(0);
    } finally {
      window.scrollTo = originalScrollTo;
      for (const [key, descriptor] of originalDescriptors) {
        if (descriptor) Object.defineProperty(document.documentElement, key, descriptor);
        else delete (document.documentElement as unknown as Record<string, unknown>)[key];
      }
    }
  });
});
