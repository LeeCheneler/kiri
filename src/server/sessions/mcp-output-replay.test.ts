import { describe, expect, it } from "bun:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  type JSONValue,
  type UIMessage,
  convertToModelMessages,
  getToolName,
  isToolUIPart,
  readUIMessageStream,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { z } from "zod";
import { boundMcpTool } from "../mcp/bound-tool.ts";
import { historyProjectionTools, withLiveProjection } from "./tool-output-projection.ts";

const TOOL = "fixture__lookup";
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type RequestMessage = { role: string; content?: unknown; tool_calls?: unknown };
type RequestBody = { messages: RequestMessage[]; tools?: unknown[] };

const sse = (delta: Record<string, unknown>, finishReason: string | null) =>
  `data: ${JSON.stringify({
    id: "response-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;

// The installed @ai-sdk/mcp adapter's projection, retained by boundMcpTool.
// Live projection must not depend on this hook: replay has no adapter or tool.
const adapterOutput = ({ output }: { output: JSONValue }) => {
  const result = output as {
    content?: { type: string; text?: string; data?: string; mimeType?: string }[];
  };
  if (!Array.isArray(result.content)) return { type: "json" as const, value: output };
  return {
    type: "content" as const,
    value: result.content.map((part) =>
      part.type === "text" && typeof part.text === "string"
        ? { type: "text" as const, text: part.text }
        : part.type === "image" &&
            typeof part.data === "string" &&
            typeof part.mimeType === "string"
          ? { type: "image-data" as const, data: part.data, mediaType: part.mimeType }
          : { type: "text" as const, text: JSON.stringify(part) },
    ),
  };
};

async function captureReplay(output: JSONValue, maxBytes = 128 * 1024) {
  const requests: RequestBody[] = [];
  let executions = 0;
  const fakeFetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      requests.push(body);
      const response =
        requests.length === 1
          ? sse(
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: TOOL, arguments: "{}" },
                  },
                ],
              },
              null,
            ) + sse({}, "tool_calls")
          : sse({ role: "assistant", content: "done" }, null) + sse({}, "stop");
      return new Response(`${response}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    },
    { preconnect: () => {} },
  );
  const provider = createOpenAICompatible({
    name: "fixture",
    baseURL: "https://fixture.invalid/v1",
    fetch: fakeFetch,
  });
  const mcpTool = boundMcpTool(
    tool({
      inputSchema: z.object({}),
      execute: async () => {
        executions++;
        return output;
      },
      toModelOutput: adapterOutput,
    }),
    { maxBytes },
  );
  const firstUser: UIMessage = {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "look up" }],
  };
  const live = streamText({
    model: provider("fixture"),
    messages: await convertToModelMessages([firstUser]),
    tools: withLiveProjection({ [TOOL]: mcpTool }),
    stopWhen: stepCountIs(2),
    maxRetries: 0,
  });
  let assistant: UIMessage | undefined;
  for await (const message of readUIMessageStream({ stream: live.toUIMessageStream() })) {
    assistant = message;
  }
  expect(assistant?.parts.filter((part) => part.type === "step-start")).toHaveLength(2);
  expect(
    assistant?.parts.some(
      (part) =>
        isToolUIPart(part) && getToolName(part) === TOOL && part.state === "output-available",
    ),
  ).toBe(true);
  expect(requests).toHaveLength(2);
  expect(executions).toBe(1);

  // Persist just the UI parts, as the session store does, then replay with no
  // MCP tool offered. History conversion must still recover the same bytes.
  const saved = JSON.parse(JSON.stringify([firstUser, assistant])) as UIMessage[];
  const newUser: UIMessage = {
    id: "user-2",
    role: "user",
    parts: [{ type: "text", text: "and now?" }],
  };
  const history = [...saved, newUser];
  const replay = streamText({
    model: provider("fixture"),
    messages: await convertToModelMessages(history, { tools: historyProjectionTools(history) }),
    maxRetries: 0,
  });
  await replay.consumeStream();

  expect(executions).toBe(1);
  expect(requests).toHaveLength(3);
  expect(requests[2]?.tools).toBeUndefined();
  expect(requests[2]?.messages.at(-1)).toMatchObject({ role: "user", content: "and now?" });
  const liveMessages = requests[1]?.messages;
  expect(requests[2]?.messages.slice(0, liveMessages?.length)).toEqual(liveMessages);
  return { liveMessages: liveMessages ?? [], saved };
}

describe("MCP output in live OpenAI-compatible requests and persisted replay", () => {
  it("replays ordinary MCP text content byte-identically across the user boundary", async () => {
    const result = await captureReplay({ content: [{ type: "text", text: "hello from MCP" }] });
    expect(result.liveMessages.find((message) => message.role === "tool")?.content).toBe(
      JSON.stringify([{ type: "text", text: "hello from MCP" }]),
    );
  });

  it("keeps mixed text and fallback content parts byte-identical", async () => {
    const result = await captureReplay({
      content: [
        { type: "text", text: "hello from MCP" },
        { type: "resource", uri: "fixture://record", name: "record" },
      ],
    });
    expect(result.liveMessages.find((message) => message.role === "tool")?.content).toBe(
      JSON.stringify([
        { type: "text", text: "hello from MCP" },
        {
          type: "text",
          text: JSON.stringify({ type: "resource", uri: "fixture://record", name: "record" }),
        },
      ]),
    );
  });

  it("replays the lean structured object shaped by boundMcpTool", async () => {
    const data = { results: [{ id: 1, label: "hello" }] };
    const result = await captureReplay({
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    });
    expect(result.liveMessages.find((message) => message.role === "tool")?.content).toBe(
      JSON.stringify(data),
    );
  });

  it("replays capped MCP content when the structured object exceeds its bound", async () => {
    const result = await captureReplay(
      {
        content: [{ type: "text", text: "x".repeat(100) }],
        structuredContent: { blob: "y".repeat(100) },
      },
      12,
    );
    expect(result.liveMessages.find((message) => message.role === "tool")?.content).toBe(
      JSON.stringify([{ type: "text", text: `${"x".repeat(12)}\n[truncated — result too large]` }]),
    );
  });

  it("preserves image bytes and media type after serializing UI parts and replaying without the tool", async () => {
    const result = await captureReplay({
      content: [
        { type: "text", text: "diagram" },
        { type: "image", data: PNG, mimeType: "image/png" },
      ],
    });
    expect(result.liveMessages.find((message) => message.role === "tool")?.content).toBe(
      JSON.stringify([
        { type: "text", text: "diagram" },
        { type: "image-data", data: PNG, mediaType: "image/png" },
      ]),
    );
    expect(JSON.stringify(result.saved)).toContain(PNG);
  });
});
