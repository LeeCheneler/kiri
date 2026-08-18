import { beforeEach, describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { http, HttpResponse } from "msw";
import { StrictMode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionChat } from "./session-chat.tsx";
import { writeSuggestedReplies } from "./suggested-replies-cache.ts";

const sessionDetail = (messages: unknown[] = [], overrides: Record<string, unknown> = {}) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    effort: "medium",
    projectId: null,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
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
  contextTokens: null,
  createdAt: "2026-05-09T12:00:00.000Z",
});

// A settled assistant turn reporting a context footprint, so the fill is known.
const assistantWithContext = (contextTokens: number) => ({
  ...message("m1", "assistant", "answer"),
  contextTokens,
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

// happy-dom has no layout, so the page never actually scrolls. Stand in for it:
// track the page offset and the foot it can scroll to, and capture the chat's own
// scrolls. The chat always asks to scroll to the foot and a real browser clamps
// that to the furthest the page allows, so `window.scrollTo` lands the offset on
// `foot` here — which is what lets a test move the foot and watch the chat cope.
// Install before rendering: the chat reads the offset as it lands on the foot.
const stubScrolling = (initialFoot: number) => {
  let top = initialFoot;
  let foot = initialFoot;
  const descriptor = Object.getOwnPropertyDescriptor(document.documentElement, "scrollTop");
  Object.defineProperty(document.documentElement, "scrollTop", {
    configurable: true,
    get: () => top,
  });
  const scrollCalls: ScrollToOptions[] = [];
  const originalScrollTo = window.scrollTo;
  window.scrollTo = ((options: ScrollToOptions) => {
    scrollCalls.push(options);
    top = foot;
  }) as typeof scrollTo;

  return {
    scrollCalls,
    // Move the page and fire the event the browser would fire for it.
    scrollTo(next: number) {
      top = next;
      window.dispatchEvent(new Event("scroll"));
    },
    // Grow or shrink the page, moving the foot the chat scrolls to.
    setFoot(next: number) {
      foot = next;
    },
    restore() {
      window.scrollTo = originalScrollTo;
      // Drop the shadowing own property so the prototype's accessor is exposed
      // again — assigning `undefined` would leave the shadow in place.
      if (descriptor) Object.defineProperty(document.documentElement, "scrollTop", descriptor);
      else Reflect.deleteProperty(document.documentElement, "scrollTop");
    },
  };
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

  it("captions the composer with the session's model and effort", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();
    expect(await screen.findByText("claude")).toBeDefined();
    expect(screen.getByText("medium")).toBeDefined();
  });

  it("captions the composer with a shortcut's name when one points at the model", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [],
          failures: [],
          shortcuts: { text: { daily: "anthropic:claude" } },
        }),
      ),
    );
    renderChat();
    expect(await screen.findByText("daily")).toBeDefined();
  });

  it("tidies the draft from the composer's shortcut when a utility model is configured", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({ models: [], failures: [], utility: "local:tiny" }),
      ),
      http.post("*/api/tidy", async ({ request }) => {
        const { text } = (await request.json()) as { text: string };
        return HttpResponse.json({ text: text.toUpperCase() });
      }),
    );
    const user = userEvent.setup();
    renderChat();
    expect(await screen.findByRole("button", { name: "tidy" })).toBeDefined();
    const field = screen.getByRole("textbox", { name: /message/i }) as HTMLTextAreaElement;

    await user.type(field, "so um postgres");
    await user.keyboard("{Meta>}{Shift>}f{/Shift}{/Meta}");

    await waitFor(() => expect(field.value).toBe("SO UM POSTGRES"));
    // The tidied draft is the draft: it persists like anything typed.
    expect(localStorage.getItem("kiri:session-draft:s1")).toBe("SO UM POSTGRES");
  });

  it("offers no tidy action without a utility model", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderChat();
    expect(await screen.findByRole("textbox", { name: /message/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: "tidy" })).toBeNull();
  });

  it("heads the page with the session's title, falling back to the short id", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([], { id: "abcdef0123", title: "Postgres upgrade plan" })),
      ),
    );
    renderChat();
    expect(await screen.findByText("Postgres upgrade plan")).toBeDefined();
    expect(screen.queryByText("abcdef01")).toBeNull();
  });

  it("heads the page with the short id while the session is untitled", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([], { id: "abcdef0123", title: null })),
      ),
    );
    renderChat();
    expect(await screen.findByText("abcdef01")).toBeDefined();
  });

  it("threads a project session's breadcrumb home through its project", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([], { projectId: "p1" })),
      ),
      http.get("*/api/projects/:id", () =>
        HttpResponse.json({
          project: { id: "p1", name: "Research", createdAt: "2026-05-09T10:00:00.000Z" },
          articles: [],
          sessions: [],
        }),
      ),
    );
    renderChat();

    const projectLink = await screen.findByRole("link", { name: "Research" });
    expect(projectLink.getAttribute("href")).toBe("/projects/p1");
    expect(screen.getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("/projects");
    expect(screen.queryByRole("link", { name: "Sessions" })).toBeNull();
  });

  it("links a project session's [[slug]] references to their corpus articles", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail(
            [
              {
                ...message("m1", "assistant", ""),
                parts: [
                  {
                    type: "text",
                    text: "The call in [[game-engine-choice]] holds per [[roadmap]]; [[unknown-doc]] does not exist.",
                  },
                ],
              },
            ],
            { projectId: "p1" },
          ),
        ),
      ),
      http.get("*/api/projects/:id", () =>
        HttpResponse.json({
          project: { id: "p1", name: "Research", createdAt: "2026-05-09T10:00:00.000Z" },
          articles: [
            {
              slug: "game-engine-choice",
              name: "game-engine-choice",
              heading: "Game Engine Choice",
              createdAt: "2026-05-09T11:00:00.000Z",
            },
            // No heading — the link falls back to the article's name.
            {
              slug: "roadmap",
              name: "roadmap",
              heading: null,
              createdAt: "2026-05-09T11:00:00.000Z",
            },
          ],
          sessions: [],
        }),
      ),
    );
    renderChat();

    const link = await screen.findByRole("link", { name: "Game Engine Choice" });
    expect(link.getAttribute("href")).toBe("/projects/p1/articles/game-engine-choice");
    // A headingless article links by its name instead.
    expect(screen.getByRole("link", { name: "roadmap" }).getAttribute("href")).toBe(
      "/projects/p1/articles/roadmap",
    );
    // A slug the corpus doesn't own stays as the literal text it was.
    expect(screen.getByText(/\[\[unknown-doc\]\] does not exist/)).toBeDefined();
  });

  it("leaves [[slug]] references literal in a projectless session's chat", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([
            {
              ...message("m1", "assistant", ""),
              parts: [{ type: "text", text: "See [[game-engine-choice]] for the call." }],
            },
          ]),
        ),
      ),
    );
    renderChat();

    expect(await screen.findByText(/\[\[game-engine-choice\]\]/)).toBeDefined();
  });

  it("warns when the conversation nears the model's context window", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantWithContext(190000)])),
      ),
      modelsWithWindow(200000),
    );
    renderChat();

    expect(await screen.findByText(/approaching context limit/i)).toBeDefined();
  });

  it("does not warn when the context fill is well within the window", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([assistantWithContext(1000)])),
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
      http.post("*/api/mcp/tool-permissions", async ({ request }) => {
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
    expect(grantBody).toEqual({ tool: "linear__create_issue", permission: "allow" });
  });

  it("allows the call even if recording the always-allow grant fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail(pausedToolTranscript())),
      ),
      http.post("*/api/mcp/tool-permissions", () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
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
      http.post("*/api/mcp/tool-permissions", () => {
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

  it("deletes a user message and the turns after it once confirmed", async () => {
    const user = userEvent.setup();
    let truncatedId: string | undefined;
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
    );
    renderChat();

    await screen.findByText("First question");
    await user.click(screen.getByRole("button", { name: "delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    // The message truncated the transcript server-side — no resend follows.
    await waitFor(() => expect(truncatedId).toBe("m1"));
    // The deleted turn leaves the transcript and stays gone (the cached detail
    // shrinks with it, so the seeded history can't re-expand the dropped turn).
    expect(await screen.findByText(/no messages yet/i)).toBeDefined();
    expect(screen.queryByText("First question")).toBeNull();
    expect(screen.queryByText("An answer")).toBeNull();
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

    // Escape stops the in-flight turn and flips its running tool call to
    // cancelled rather than leaving it on "working".
    await screen.findByText(/escape to cancel/i);
    await user.keyboard("{Escape}");
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

  it("rejoins an in-flight turn's stream on load", async () => {
    // The session is running with only the user message persisted; resume
    // reconnects to the live stream and renders the assistant reply as it arrives.
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "Question")], { status: "running" }),
        ),
      ),
      http.get("*/api/sessions/:id/stream", () => assistantReply("rejoined live")),
    );
    renderChat();

    expect(await screen.findByText("rejoined live")).toBeDefined();
  });

  it("reconstructs a tool call's state when rejoining a turn", async () => {
    // The rejoined stream carries the same frames the original turn emitted — the
    // tool call and its result — so the tool block reconstructs, not just text.
    const toolResume = () =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({
              type: "tool-input-available",
              toolCallId: "c1",
              toolName: "filesystem__search_files",
              input: { query: "readme" },
            });
            writer.write({ type: "tool-output-available", toolCallId: "c1", output: { hits: 3 } });
            writer.write({ type: "text-start", id: "t1" });
            writer.write({ type: "text-delta", id: "t1", delta: "Found it." });
            writer.write({ type: "text-end", id: "t1" });
          },
        }),
      });
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "search the readme")], { status: "running" }),
        ),
      ),
      http.get("*/api/sessions/:id/stream", () => toolResume()),
    );
    const { container } = renderChat();

    expect(await screen.findByText("Found it.")).toBeDefined();
    expect(container.querySelector('[data-status="ok"]')).not.toBeNull();
  });

  it("rejoins exactly once under StrictMode's double-invoked effects", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail([message("m1", "user", "Question")], { status: "running" }),
        ),
      ),
      http.get("*/api/sessions/:id/stream", () => assistantReply("rejoined once")),
    );
    const queryClient = createQueryClient();
    const { hook } = memoryLocation({ path: "/sessions/s1" });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <Router hook={hook}>
            <SessionChat id="s1" />
          </Router>
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(await screen.findByText("rejoined once")).toBeDefined();
    expect(screen.getAllByText("rejoined once")).toHaveLength(1);
  });

  it("does not re-render a settled turn when there is nothing to resume", async () => {
    // History already holds the finished assistant turn; resume finds no live
    // stream (the default 204), so the reply isn't duplicated onto the transcript.
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

    await screen.findByText("An answer");
    expect(screen.getAllByText("An answer")).toHaveLength(1);
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

  it("folds in a turn that grew an existing message's parts while away", async () => {
    // An approval resumed elsewhere extends the paused assistant message in
    // place — same message count, more parts — so the fold-in must compare
    // parts, not just messages.
    let detail = sessionDetail(
      [message("m1", "user", "Question"), message("m2", "assistant", "Working on it.")],
      { status: "running" },
    );
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const { queryClient } = renderChat();

    await screen.findByText("Working on it.");

    detail = sessionDetail(
      [
        message("m1", "user", "Question"),
        {
          ...message("m2", "assistant", "Working on it."),
          parts: [
            { type: "text", text: "Working on it." },
            { type: "text", text: "Now finished." },
          ],
        },
      ],
      { status: "idle" },
    );
    await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });

    expect(await screen.findByText("Now finished.")).toBeDefined();
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

  it("rejects a pasted image when the session's model reads text only", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", imageInput: false },
          ],
          failures: [],
        }),
      ),
    );
    renderChat();

    const textbox = await screen.findByRole("textbox", { name: /message/i });
    fireEvent.paste(textbox, {
      clipboardData: { files: [new File(["img"], "shot.png", { type: "image/png" })] },
    });

    expect(await screen.findByText(/reads text only/i)).toBeDefined();
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
    const scroll = stubScrolling(0);

    try {
      renderChat();
      await screen.findByText("Latest reply");

      // Landing jumps straight to the latest message: an instant scroll that
      // opts out of the document's smooth scroll-behavior.
      expect(scroll.scrollCalls.some((o) => o.behavior === "instant")).toBe(true);
      expect(scroll.scrollCalls.some((o) => o.behavior === "smooth")).toBe(false);
    } finally {
      scroll.restore();
    }
  });

  it("stops following the transcript once the user scrolls up, even by a pixel", async () => {
    let detail = sessionDetail([message("m1", "user", "Question")], { status: "running" });
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const scroll = stubScrolling(5000);

    try {
      const { queryClient } = renderChat();
      await screen.findByText(/working/i);
      scroll.scrollCalls.length = 0;

      // One pixel of upward movement is enough to hand control to the user.
      scroll.scrollTo(4999);

      // The turn settles off-screen and folds in. Because the user scrolled up,
      // the new message must not yank the page back to the foot.
      detail = sessionDetail(
        [message("m1", "user", "Question"), message("m2", "assistant", "An answer")],
        { status: "idle" },
      );
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      await screen.findByText("An answer");

      expect(scroll.scrollCalls).toHaveLength(0);
    } finally {
      scroll.restore();
    }
  });

  it("keeps following the transcript when the page scrolls down beneath it", async () => {
    let detail = sessionDetail([message("m1", "user", "Question")], { status: "running" });
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const scroll = stubScrolling(5000);

    try {
      const { queryClient } = renderChat();
      await screen.findByText(/working/i);
      scroll.scrollCalls.length = 0;

      // Downward movement is the page growing under a pinned view and our own
      // follow chasing the new foot — not the user — so it stays pinned.
      scroll.setFoot(5200);
      scroll.scrollTo(5200);

      detail = sessionDetail(
        [message("m1", "user", "Question"), message("m2", "assistant", "An answer")],
        { status: "idle" },
      );
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      await screen.findByText("An answer");

      expect(scroll.scrollCalls.some((o) => o.behavior === "instant")).toBe(true);
    } finally {
      scroll.restore();
    }
  });

  it("keeps following when the page shortens under a followed message", async () => {
    let detail = sessionDetail([message("m1", "user", "Question")], { status: "running" });
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(detail)));
    const scroll = stubScrolling(5000);

    try {
      const { queryClient } = renderChat();
      await screen.findByText(/working/i);

      // The page gets shorter as the turn settles — the working cue goes away, and
      // sending collapses a tall composer — so following the new message lands the
      // page *above* the offset we last saw. That drop is our own scroll, not the
      // user's, and must not un-pin.
      scroll.setFoot(4800);
      detail = sessionDetail(
        [message("m1", "user", "Question"), message("m2", "assistant", "An answer")],
        { status: "idle" },
      );
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      await screen.findByText("An answer");
      window.dispatchEvent(new Event("scroll"));
      scroll.scrollCalls.length = 0;

      // Still pinned, so the next message is followed too.
      detail = sessionDetail(
        [
          message("m1", "user", "Question"),
          message("m2", "assistant", "An answer"),
          message("m3", "user", "Another"),
        ],
        { status: "idle" },
      );
      await queryClient.invalidateQueries({ queryKey: ["session", "s1"] });
      await screen.findByText("Another");

      expect(scroll.scrollCalls.some((o) => o.behavior === "instant")).toBe(true);
    } finally {
      scroll.restore();
    }
  });

  it("re-pins to the foot when the next message is sent", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail([message("m1", "assistant", "An answer")])),
      ),
      http.post("*/api/sessions/:id/messages", () => assistantReply("Hi back")),
    );
    const scroll = stubScrolling(5000);

    try {
      renderChat();
      await screen.findByText("An answer");

      // Scrolling up to re-read only un-pins until the next turn.
      scroll.scrollTo(1000);
      scroll.scrollCalls.length = 0;

      await user.type(screen.getByRole("textbox", { name: /message/i }), "Hello there");
      await user.keyboard("{Enter}");
      await screen.findByText("Hi back");

      expect(scroll.scrollCalls.some((o) => o.behavior === "instant")).toBe(true);
    } finally {
      scroll.restore();
    }
  });

  describe("suggested replies", () => {
    // The freshness gate only asks about a recently settled turn, so these
    // fixtures carry a live timestamp where the shared ones are dated.
    const recentMessage = (id: string, role: "user" | "assistant", text: string) => ({
      ...message(id, role, text),
      createdAt: new Date().toISOString(),
    });

    const settledTranscript = () => [
      recentMessage("m1", "user", "Rename the module?"),
      recentMessage("m2", "assistant", "Shall I go ahead?"),
    ];

    // Count requests to the suggested-replies endpoint, answering `replies`.
    const countingRepliesHandler = (replies: string[]) => {
      const calls = { count: 0 };
      const handler = http.get("*/api/sessions/:id/suggested-replies", () => {
        calls.count += 1;
        return HttpResponse.json({ replies });
      });
      return { calls, handler };
    };

    // Let any wrongly-eligible fetch reach the counting handler before
    // asserting none did — absence needs a beat, presence is awaited.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it("offers replies for a settled turn and sends the tapped one", async () => {
      const user = userEvent.setup();
      let sentText: string | null = null;
      server.use(
        http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(settledTranscript()))),
        http.get("*/api/sessions/:id/suggested-replies", () =>
          HttpResponse.json({ replies: ["Yes, proceed", "No, hold off"] }),
        ),
        http.post("*/api/sessions/:id/messages", async ({ request }) => {
          const body = (await request.json()) as {
            message: { parts: { type: string; text?: string }[] };
          };
          sentText = body.message.parts.find((p) => p.type === "text")?.text ?? null;
          return parkedReply();
        }),
      );
      renderChat();

      const chip = await screen.findByRole("button", { name: "Yes, proceed" });
      expect(screen.getByRole("group", { name: "Suggested replies" })).toBeDefined();
      expect(screen.getByRole("button", { name: "No, hold off" })).toBeDefined();

      await user.click(chip);

      // The chip's text went down the ordinary send path, and the row hides
      // the moment the turn is in flight.
      await waitFor(() => expect(sentText).toBe("Yes, proceed"));
      await waitFor(() =>
        expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull(),
      );
    });

    it("shows no chips when the server offers none", async () => {
      // No suggested-replies override: the fetch rides the msw default's
      // empty answer, the same shape a real "not now" response takes.
      server.use(
        http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(settledTranscript()))),
      );
      renderChat();

      await screen.findByText("Shall I go ahead?");
      await settle();
      expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull();
    });

    it("serves a cached answer without asking again", async () => {
      writeSuggestedReplies("m2", ["Yes, proceed"]);
      const { calls, handler } = countingRepliesHandler(["Never served"]);
      server.use(
        http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(settledTranscript()))),
        handler,
      );
      renderChat();

      expect(await screen.findByRole("button", { name: "Yes, proceed" })).toBeDefined();
      await settle();
      expect(calls.count).toBe(0);
    });

    it("holds a cached empty answer as answered, not unasked", async () => {
      writeSuggestedReplies("m2", []);
      const { calls, handler } = countingRepliesHandler(["Never served"]);
      server.use(
        http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(settledTranscript()))),
        handler,
      );
      renderChat();

      await screen.findByText("Shall I go ahead?");
      await settle();
      expect(calls.count).toBe(0);
      expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull();
    });

    it("does not ask about a turn older than the freshness window", async () => {
      const { calls, handler } = countingRepliesHandler(["Never served"]);
      server.use(
        http.get("*/api/sessions/:id", () =>
          HttpResponse.json(
            sessionDetail([
              message("m1", "user", "Rename the module?"),
              message("m2", "assistant", "Shall I go ahead?"),
            ]),
          ),
        ),
        handler,
      );
      renderChat();

      await screen.findByText("Shall I go ahead?");
      await settle();
      expect(calls.count).toBe(0);
      expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull();
    });

    it("does not ask while a tool approval is pending", async () => {
      const { calls, handler } = countingRepliesHandler(["Never served"]);
      server.use(
        http.get("*/api/sessions/:id", () =>
          HttpResponse.json(
            sessionDetail([
              recentMessage("m1", "user", "open an issue"),
              {
                ...recentMessage("m2", "assistant", "I'd like to open this issue — allow it?"),
                parts: [
                  { type: "text", text: "I'd like to open this issue — allow it?" },
                  {
                    type: "tool-linear__create_issue",
                    toolCallId: "c1",
                    state: "approval-requested",
                    input: { title: "Bug" },
                    approval: { id: "a1" },
                  },
                ],
              },
            ]),
          ),
        ),
        handler,
      );
      renderChat();

      await screen.findByText(/allow it\?/);
      await settle();
      expect(calls.count).toBe(0);
    });

    it("shows nothing when the request fails", async () => {
      server.use(
        http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail(settledTranscript()))),
        http.get("*/api/sessions/:id/suggested-replies", () =>
          HttpResponse.json({ error: "boom" }, { status: 500 }),
        ),
      );
      renderChat();

      await screen.findByText("Shall I go ahead?");
      await settle();
      expect(screen.queryByRole("group", { name: "Suggested replies" })).toBeNull();
    });
  });
});
