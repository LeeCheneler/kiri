import { describe, expect, it } from "bun:test";
import { type MCPTransport, createMCPClient } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { boundMcpTool } from "./bound-tool.ts";

const run = (tool: ToolSet[string], signal?: AbortSignal): Promise<unknown> =>
  (tool.execute as (input: unknown, opts: ToolExecutionOptions) => Promise<unknown>)(
    {},
    {
      toolCallId: "call",
      messages: [],
      abortSignal: signal,
    },
  );

async function within(pending: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Tool did not settle within 500ms")), 500);
  });
  try {
    return await Promise.race([pending, watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

// Keep both SDKs real; only replace the remote HTTP server with in-memory replies.
async function sdkTools() {
  const started = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<Response>();
  const lateHandled = Promise.withResolvers<void>();
  const errors: unknown[] = [];
  const calls: string[] = [];
  let silentId = 0;
  const transport = new StreamableHTTPClientTransport(new URL("https://memory.test/mcp"), {
    fetch: async (_input, init) => {
      if (init?.method === "GET") return new Response(null, { status: 405 });
      const message = JSON.parse(init?.body as string);
      const response = (result: unknown) =>
        Response.json({ jsonrpc: "2.0", id: message.id, result });
      if (message.method === "initialize")
        return response({
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "memory", version: "1" },
        });
      if (message.method === "tools/list")
        return response({
          tools: ["silent", "other"].map((name) => ({
            name,
            inputSchema: { type: "object", properties: {} },
          })),
        });
      if (message.method !== "tools/call") return new Response(null, { status: 202 });
      calls.push(message.params.name);
      if (message.params.name === "silent") {
        silentId = message.id;
        started.resolve();
        return reply.promise;
      }
      return response({ content: [{ type: "text", text: "other completed" }] });
    },
  });
  const client = await createMCPClient({
    transport: transport as unknown as MCPTransport,
    maxRetries: 0,
    onUncaughtError: (error) => {
      errors.push(error);
      lateHandled.resolve();
    },
  });
  const tools = (await client.tools()) as unknown as ToolSet;
  const lateReply = () =>
    reply.resolve(
      Response.json({
        jsonrpc: "2.0",
        id: silentId,
        result: { content: [{ type: "text", text: "too late" }] },
      }),
    );
  return {
    client,
    tools,
    started: started.promise,
    lateHandled: lateHandled.promise,
    lateReply,
    calls,
    errors,
  };
}

describe("MCP SDK deadline integration", () => {
  it.each(["timeout", "cancel"] as const)(
    "settles a silent request on %s, absorbs late replies, and leaves other calls usable",
    async (ending) => {
      const fixture = await sdkTools();
      const controller = new AbortController();
      const reason = new Error("cancelled by user");
      try {
        const pending = run(
          boundMcpTool(fixture.tools.silent, {
            timeoutMs: ending === "timeout" ? 20 : 180_000,
          }),
          controller.signal,
        );
        await fixture.started;
        const concurrent = run(boundMcpTool(fixture.tools.other));
        if (ending === "cancel") controller.abort(reason);
        if (ending === "timeout") await expect(within(pending)).rejects.toThrow(/time budget/);
        else await expect(within(pending)).rejects.toBe(reason);
        await expect(concurrent).resolves.toEqual({
          content: [{ type: "text", text: "other completed" }],
          isError: false,
        });

        fixture.lateReply();
        await within(fixture.lateHandled);
        // The upgraded client has removed the cancelled handler. Its late-id
        // error is contained by the real transport, not applied to another call.
        expect(String(fixture.errors[0])).toContain("unknown message ID");
        await expect(run(boundMcpTool(fixture.tools.other))).resolves.toEqual({
          content: [{ type: "text", text: "other completed" }],
          isError: false,
        });
        expect(fixture.calls).toEqual(["silent", "other", "other"]);
      } finally {
        controller.abort();
        fixture.lateReply();
        await fixture.client.close();
      }
    },
  );
});
