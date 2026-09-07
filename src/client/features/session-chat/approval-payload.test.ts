import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { prepareSessionTurnRequest } from "./use-session-conversation.ts";

const API_BODY_LIMIT_BYTES = 256 * 1024;
const parts = (...values: unknown[]): UIMessage["parts"] => values as UIMessage["parts"];

const approvalMessage = (approved: boolean): UIMessage => ({
  id: "assistant-1",
  role: "assistant",
  parts: parts(
    {
      type: "tool-read_file",
      toolCallId: "read-1",
      state: "output-available",
      input: { path: "/workspace/large.log" },
      output: "x".repeat(API_BODY_LIMIT_BYTES + 1),
    },
    { type: "step-start" },
    {
      type: "tool-run_command",
      toolCallId: "command-1",
      state: "approval-responded",
      input: { command: "bun test", cwd: "/workspace", timeout_seconds: 120 },
      approval: { id: "approval-1", approved },
    },
  ),
});

describe("prepareSessionTurnRequest", () => {
  for (const approved of [true, false]) {
    it(`projects an oversized assistant turn to its ${approved ? "allowed" : "denied"} tool response`, () => {
      const message = approvalMessage(approved);

      expect(new TextEncoder().encode(JSON.stringify({ message })).byteLength).toBeGreaterThan(
        API_BODY_LIMIT_BYTES,
      );

      const projected = prepareSessionTurnRequest({ messages: [message] }).body.message;

      expect(projected).toEqual({
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-run_command",
            toolCallId: "command-1",
            state: "approval-responded",
            input: { command: "bun test", cwd: "/workspace", timeout_seconds: 120 },
            approval: { id: "approval-1", approved },
          },
        ],
      });
      expect(
        new TextEncoder().encode(JSON.stringify({ message: projected })).byteLength,
      ).toBeLessThan(API_BODY_LIMIT_BYTES);
    });
  }

  it("leaves a user message unchanged", () => {
    const message: UIMessage = {
      id: "user-1",
      role: "user",
      parts: parts(
        { type: "text", text: "Review this attachment" },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "large.txt",
          url: `data:text/plain;base64,${"eA==".repeat(API_BODY_LIMIT_BYTES)}`,
        },
      ),
    };

    expect(prepareSessionTurnRequest({ messages: [message] }).body.message).toBe(message);
  });
});
