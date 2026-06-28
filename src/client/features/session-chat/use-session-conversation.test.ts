import { describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  type UIMessage,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isToolUIPart,
} from "ai";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { useSessionConversation } from "./use-session-conversation.ts";

// The hook reads only id + status off the session row.
const sessionRow = (id: string, status = "idle") => ({ id, status });

const userMessage = (text: string): UIMessage => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

// A paused assistant turn: a tool call awaiting the user's approval verdict.
const pausedApprovalTranscript = (): UIMessage[] => [
  userMessage("open an issue"),
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "tool-linear__create_issue",
        toolCallId: "c1",
        state: "approval-requested",
        input: { title: "Bug" },
        approval: { id: "a1" },
      },
    ] as UIMessage["parts"],
  },
];

// An assistant turn left running with a tool call in flight.
const runningToolTranscript = (): UIMessage[] => [
  userMessage("search"),
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "tool-filesystem__search_files",
        toolCallId: "c1",
        state: "input-available",
        input: { query: "x" },
      },
    ] as UIMessage["parts"],
  },
];

// A paused assistant turn: a client-completed tool call (no execute) awaiting its
// output, the shape the transcript seeds from while an investigation runs.
const pausedInvestigateTranscript = (): UIMessage[] => [
  userMessage("compare X and Y"),
  {
    id: "m2",
    role: "assistant",
    parts: [
      {
        type: "tool-investigate",
        toolCallId: "c1",
        state: "input-available",
        input: { task: "compare X and Y" },
      },
    ] as UIMessage["parts"],
  },
];

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

// A resume response: the paused tool resolves (ran or refused), then follow-up text.
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

const assistantText = (messages: UIMessage[]): string | undefined => {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  return last.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
};

const approvalPart = (messages: UIMessage[]) => {
  const part = messages
    .at(-1)
    ?.parts.find((p) => isToolUIPart(p) && p.state === "approval-requested");
  return part as Parameters<ReturnType<typeof useSessionConversation>["onToolDecision"]>[0];
};

describe("useSessionConversation", () => {
  it("seeds the transcript from the persisted history", () => {
    const { result } = renderHook(() =>
      useSessionConversation({ session: sessionRow("sc1"), initialMessages: [userMessage("hi")] }),
    );
    expect(result.current.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("folds in a finished turn that grew an existing message's parts, not just the count", () => {
    // A single assistant message gains parts in place — the shape of an
    // investigation finishing after a reload: the same message picks up each
    // inner tool call. A message-count check alone would miss this.
    const toolPart = (toolCallId: string) => ({
      type: "tool-tavily__search",
      toolCallId,
      state: "output-available",
      input: { query: "x" },
      output: { hits: 1 },
    });
    const seeded: UIMessage[] = [
      userMessage("compare"),
      { id: "m2", role: "assistant", parts: [toolPart("c1")] as UIMessage["parts"] },
    ];
    const grown: UIMessage[] = [
      userMessage("compare"),
      {
        id: "m2",
        role: "assistant",
        parts: [
          toolPart("c1"),
          toolPart("c2"),
          { type: "text", text: "X wins." },
        ] as UIMessage["parts"],
      },
    ];

    const { result, rerender } = renderHook(
      ({ initialMessages }: { initialMessages: UIMessage[] }) =>
        useSessionConversation({ session: sessionRow("sc-fold"), initialMessages }),
      { initialProps: { initialMessages: seeded } },
    );
    // Seeded with the partial transcript — one tool call on the message.
    expect(result.current.messages.at(-1)?.parts).toHaveLength(1);

    act(() => rerender({ initialMessages: grown }));

    // The grown history is folded in even though the message count is unchanged.
    expect(result.current.messages.at(-1)?.parts).toHaveLength(3);
  });

  it("reports busy when a turn is running elsewhere, even though this view is idle", () => {
    const running = renderHook(() =>
      useSessionConversation({ session: sessionRow("sc2", "running"), initialMessages: [] }),
    );
    expect(running.result.current.busy).toBe(true);

    const idle = renderHook(() =>
      useSessionConversation({ session: sessionRow("sc3", "idle"), initialMessages: [] }),
    );
    expect(idle.result.current.busy).toBe(false);
  });

  it("flags awaitingApproval when the last turn holds an unanswered tool call", () => {
    const paused = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc4"),
        initialMessages: pausedApprovalTranscript(),
      }),
    );
    expect(paused.result.current.awaitingApproval).toBe(true);

    const plain = renderHook(() =>
      useSessionConversation({ session: sessionRow("sc5"), initialMessages: [userMessage("hi")] }),
    );
    expect(plain.result.current.awaitingApproval).toBe(false);
  });

  it("sends a turn and streams the assistant reply into the transcript", async () => {
    server.use(http.post("*/api/sessions/:id/messages", () => assistantReply("hello there")));
    const { result } = renderHook(() =>
      useSessionConversation({ session: sessionRow("sc6"), initialMessages: [] }),
    );

    await act(async () => {
      await result.current.sendMessage({ parts: [{ type: "text", text: "hi" }] });
    });

    await waitFor(() => expect(assistantText(result.current.messages)).toBe("hello there"));
  });

  it("records a grant then approves on an always-allow verdict", async () => {
    let grantBody: unknown;
    server.use(
      http.post("*/api/tool-grants", async ({ request }) => {
        grantBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", () => resumeReply({ output: { ok: true } }, "done")),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc7"),
        initialMessages: pausedApprovalTranscript(),
      }),
    );

    await act(async () => {
      result.current.onToolDecision(approvalPart(result.current.messages), "always");
    });

    await waitFor(() => expect(grantBody).toEqual({ tool: "linear__create_issue" }));
    await waitFor(() => expect(assistantText(result.current.messages)).toBe("done"));
  });

  it("refuses without recording a grant on a deny verdict", async () => {
    let granted = false;
    let sentApproved: boolean | undefined;
    server.use(
      http.post("*/api/tool-grants", () => {
        granted = true;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        const body = (await request.json()) as { message: { parts: { type: string }[] } };
        const part = body.message.parts.find((p) => p.type.startsWith("tool-")) as {
          approval?: { approved?: boolean };
        };
        sentApproved = part?.approval?.approved;
        return resumeReply({ denied: true }, "skipped it");
      }),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc8"),
        initialMessages: pausedApprovalTranscript(),
      }),
    );

    await act(async () => {
      result.current.onToolDecision(approvalPart(result.current.messages), "deny");
    });

    await waitFor(() => expect(sentApproved).toBe(false));
    expect(granted).toBe(false);
  });

  it("supplies a client-completed tool output and auto-resumes the turn", async () => {
    let sentOutput: unknown;
    server.use(
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        const body = (await request.json()) as {
          message: { parts: { type: string; output?: unknown }[] };
        };
        sentOutput = body.message.parts.find((p) => p.type.startsWith("tool-"))?.output;
        return resumeReply({ output: "X beats Y" }, "Per the report, X wins.");
      }),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc12"),
        initialMessages: pausedInvestigateTranscript(),
      }),
    );

    await act(async () => {
      result.current.addToolOutput({ tool: "investigate", toolCallId: "c1", output: "X beats Y" });
    });

    // The output was posted back and the model's continuation streamed in.
    await waitFor(() =>
      expect(assistantText(result.current.messages)).toBe("Per the report, X wins."),
    );
    expect(sentOutput).toBe("X beats Y");
  });

  it("cancel marks a running tool call cancelled and aborts the server turn", async () => {
    let cancelled = false;
    server.use(
      http.post("*/api/sessions/:id/cancel", () => {
        cancelled = true;
        return HttpResponse.json({ sessionId: "sc9" });
      }),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc9", "running"),
        initialMessages: runningToolTranscript(),
      }),
    );

    await act(async () => {
      result.current.cancel();
    });

    await waitFor(() => expect(cancelled).toBe(true));
    const toolPart = result.current.messages.at(-1)?.parts.find((p) => isToolUIPart(p));
    expect((toolPart as { state?: string })?.state).toBe("output-error");
  });

  it("resubmit truncates back to the edited message, then re-runs from it", async () => {
    let truncatedId: string | undefined;
    server.use(
      http.delete("*/api/sessions/:id/messages/:messageId", ({ params }) => {
        truncatedId = params.messageId as string;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/api/sessions/:id/messages", () => assistantReply("re-run")),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc10"),
        initialMessages: [
          userMessage("first"),
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "old" }] },
        ],
      }),
    );

    await act(async () => {
      await result.current.resubmit("u1", [{ type: "text", text: "edited" }]);
    });

    await waitFor(() => expect(truncatedId).toBe("u1"));
    await waitFor(() => expect(assistantText(result.current.messages)).toBe("re-run"));
  });

  it("resubmit is a no-op while a turn is in flight", async () => {
    let truncated = false;
    server.use(
      http.delete("*/api/sessions/:id/messages/:messageId", () => {
        truncated = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() =>
      useSessionConversation({
        session: sessionRow("sc11", "running"),
        initialMessages: [userMessage("hi")],
      }),
    );

    await act(async () => {
      await result.current.resubmit("u1", [{ type: "text", text: "edited" }]);
    });

    expect(truncated).toBe(false);
  });
});
