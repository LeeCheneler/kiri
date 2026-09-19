import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { MESSAGE_BODY_LIMIT_BYTES, MESSAGE_SIZE_ERROR } from "../../../shared/message-limits.ts";
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
    it(`reduces an oversized assistant turn to its ${approved ? "allowed" : "denied"} verdict`, () => {
      const message = approvalMessage(approved);

      expect(new TextEncoder().encode(JSON.stringify({ message })).byteLength).toBeGreaterThan(
        API_BODY_LIMIT_BYTES,
      );

      const { body } = prepareSessionTurnRequest({ messages: [message] });

      // The call is named by id alone: its input stays with the server.
      expect(body).toEqual({ approvals: [{ toolCallId: "command-1", approved }] });
    });
  }

  it("rejects a request whose envelope pushes it past the wire limit", () => {
    expect(() =>
      prepareSessionTurnRequest({
        messages: [
          {
            id: "x".repeat(MESSAGE_BODY_LIMIT_BYTES),
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        ],
      }),
    ).toThrow(MESSAGE_SIZE_ERROR);
  });

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

    expect(prepareSessionTurnRequest({ messages: [message] }).body).toEqual({ message });
  });
});
