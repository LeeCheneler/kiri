import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type UIMessage, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { useSessionConversation } from "./use-session-conversation.ts";

const message = (text: string): UIMessage => ({
  id: "a1",
  role: "assistant",
  parts: [{ type: "text", text }],
});

const snapshot = (revision: number, messages: UIMessage[], status = "idle", id = "s1") => ({
  session: { id, status },
  initialMessages: messages,
  transcriptRevision: revision,
});

const detail = (value: ReturnType<typeof snapshot>) => ({
  session: value.session,
  messages: value.initialMessages,
  transcriptRevision: value.transcriptRevision,
  inbox: [],
});

const mount = (initialProps: ReturnType<typeof snapshot>) => {
  const client = createQueryClient();
  return renderHook((props) => useSessionConversation(props), {
    initialProps,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const reply = (text: string, finish = Promise.resolve()) =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        writer.write({ type: "text-start", id: "text1" });
        writer.write({ type: "text-delta", id: "text1", delta: text });
        await finish;
        writer.write({ type: "text-end", id: "text1" });
      },
    }),
  });

describe("transcript reconciliation", () => {
  it("ignores a delayed deletion response overtaken by a newer snapshot", async () => {
    const deleted = deferred();
    server.use(
      http.delete("*/api/sessions/:id/messages/:messageId", async () => {
        await deleted.promise;
        return HttpResponse.json({ transcriptRevision: 2 });
      }),
    );
    const { result, rerender } = mount(snapshot(1, [message("old")]));
    const removing = result.current.deleteMessage("a1");
    rerender(snapshot(3, [message("newer turn")]));
    await act(async () => {
      deleted.resolve();
      await removing;
    });
    expect(result.current.messages).toEqual([message("newer turn")]);
  });

  it("preserves local text when the post-stream read fails", async () => {
    let reads = 0;
    server.use(
      http.post("*/api/sessions/:id/messages", () => reply("local text")),
      http.get("*/api/sessions/:id", () => {
        reads += 1;
        return HttpResponse.json({ error: "read failed" }, { status: 500 });
      }),
    );
    const { result, rerender } = mount(snapshot(0, []));
    await act(async () => result.current.sendMessage({ text: "hello" }));
    await waitFor(() => expect(reads).toBe(1));
    rerender(snapshot(1, []));
    expect(
      result.current.messages
        .at(-1)
        ?.parts.some((part) => part.type === "text" && part.text === "local text"),
    ).toBe(true);
  });

  it("reconciles a resumed stream with its final committed snapshot", async () => {
    server.use(
      http.get("*/api/sessions/:id/stream", () => reply("replayed")),
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(detail(snapshot(5, [message("final")]))),
      ),
    );
    const { result } = mount(snapshot(2, [], "running"));
    await waitFor(() => expect(result.current.messages).toEqual([message("final")]));
  });

  it("keeps a cancelled tail through a running baseline until persistence finishes", async () => {
    const finish = deferred();
    let reads = 0;
    server.use(
      http.post("*/api/sessions/:id/messages", () => reply("partial answer", finish.promise)),
      http.post("*/api/sessions/:id/cancel", () => {
        finish.resolve();
        return HttpResponse.json({ sessionId: "s1" });
      }),
      http.get("*/api/sessions/:id", () => {
        reads += 1;
        return HttpResponse.json(detail(snapshot(2, [], "running")));
      }),
    );
    const { result, rerender } = mount(snapshot(1, []));
    act(() => void result.current.sendMessage({ text: "hello" }));
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    expect(
      result.current.messages
        .at(-1)
        ?.parts.some((part) => part.type === "text" && part.text === "partial answer"),
    ).toBe(true);
    rerender(snapshot(3, [message("saved partial answer")], "cancelled"));
    await waitFor(() => expect(result.current.messages).toEqual([message("saved partial answer")]));
    finish.resolve();
  });

  it("accepts same-size replacements and remote deletions only at newer revisions", async () => {
    const { result, rerender } = mount(snapshot(4, [message("old")]));
    rerender(snapshot(5, [message("new")]));
    await waitFor(() => expect(result.current.messages).toEqual([message("new")]));
    rerender(snapshot(4, [message("old")]));
    expect(result.current.messages).toEqual([message("new")]);
    rerender(snapshot(6, []));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    rerender(snapshot(5, [message("new")]));
    expect(result.current.messages).toEqual([]);
  });

  it("keeps streamed text through late baselines, then loads the committed revision", async () => {
    const finish = deferred();
    const read = deferred();
    let reads = 0;
    server.use(
      http.post("*/api/sessions/:id/messages", () => reply("live", finish.promise)),
      http.get("*/api/sessions/:id", async () => {
        reads += 1;
        await read.promise;
        return HttpResponse.json(detail(snapshot(8, [message("saved")])));
      }),
    );
    const { result, rerender } = mount(snapshot(4, []));
    act(() => void result.current.sendMessage({ text: "hello" }));
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    rerender(snapshot(6, [message("baseline")], "running"));
    expect(result.current.messages.at(-1)?.parts).toContainEqual({
      type: "text",
      text: "live",
      state: "streaming",
    });
    await act(async () => finish.resolve());
    await waitFor(() => expect(reads).toBe(1));
    rerender(snapshot(7, [message("late snapshot")]));
    expect(
      result.current.messages
        .at(-1)
        ?.parts.some((part) => part.type === "text" && part.text === "live"),
    ).toBe(true);
    await act(async () => read.resolve());
    await waitFor(() => expect(result.current.messages).toEqual([message("saved")]));
    rerender(snapshot(7, [message("late snapshot")]));
    expect(result.current.messages).toEqual([message("saved")]);
  });

  it("does not let a previous turn's delayed read overwrite a new turn", async () => {
    const read = deferred();
    const finish = deferred();
    let reads = 0;
    let turns = 0;
    server.use(
      http.post("*/api/sessions/:id/messages", () =>
        reply(++turns === 1 ? "first" : "second", turns === 1 ? Promise.resolve() : finish.promise),
      ),
      http.get("*/api/sessions/:id", async () => {
        reads += 1;
        if (reads === 1) await read.promise;
        return HttpResponse.json(detail(snapshot(10, [message("old persisted turn")])));
      }),
    );
    const { result } = mount(snapshot(0, []));
    await act(async () => result.current.sendMessage({ text: "one" }));
    await waitFor(() => expect(reads).toBe(1));
    act(() => void result.current.sendMessage({ text: "two" }));
    await waitFor(() => expect(result.current.status).toBe("streaming"));
    await act(async () => read.resolve());
    expect(
      result.current.messages
        .at(-1)
        ?.parts.some((part) => part.type === "text" && part.text === "second"),
    ).toBe(true);
    await act(async () => finish.resolve());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("does not apply a delayed finish read after switching sessions", async () => {
    const read = deferred();
    let reads = 0;
    server.use(
      http.post("*/api/sessions/:id/messages", () => reply("first")),
      http.get("*/api/sessions/:id", async () => {
        reads += 1;
        await read.promise;
        return HttpResponse.json(detail(snapshot(10, [message("old session")])));
      }),
    );
    const { result, rerender } = mount(snapshot(0, []));
    await act(async () => result.current.sendMessage({ text: "one" }));
    await waitFor(() => expect(reads).toBe(1));
    rerender(snapshot(2, [message("other session")], "idle", "s2"));
    await act(async () => read.resolve());
    expect(result.current.messages).toEqual([message("other session")]);
  });

  it("keeps partial approval decisions through snapshots until all verdicts are sent", async () => {
    const pending: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [1, 2].map((n) => ({
        type: "tool-echo",
        toolCallId: `c${n}`,
        state: "approval-requested",
        input: {},
        approval: { id: `approval-${n}` },
      })),
    };
    let posted: { message: UIMessage } | undefined;
    server.use(
      http.post("*/api/sessions/:id/messages", async ({ request }) => {
        posted = (await request.json()) as { message: UIMessage };
        return createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: "tool-output-available", toolCallId: "c1", output: {} });
              writer.write({ type: "tool-output-denied", toolCallId: "c2" });
            },
          }),
        });
      }),
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(detail(snapshot(4, [message("done")]))),
      ),
    );
    const { result, rerender } = mount(snapshot(1, [pending], "waiting"));
    const [first, second] = pending.parts;
    if (first?.type !== "tool-echo" || second?.type !== "tool-echo")
      throw new Error("missing approval");
    act(() => result.current.onToolDecision(first, "allow"));
    rerender(snapshot(2, [pending], "waiting"));
    expect(result.current.messages[0]?.parts[0]).toMatchObject({ state: "approval-responded" });
    expect(posted).toBeUndefined();
    act(() => result.current.onToolDecision(second, "deny"));
    await waitFor(() =>
      expect(posted?.message.parts).toEqual([
        expect.objectContaining({
          state: "approval-responded",
          approval: { id: "approval-1", approved: true },
        }),
        expect.objectContaining({
          state: "approval-responded",
          approval: { id: "approval-2", approved: false },
        }),
      ]),
    );
    await waitFor(() => expect(result.current.messages).toEqual([message("done")]));
  });
});
