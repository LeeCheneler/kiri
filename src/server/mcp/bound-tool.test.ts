import { describe, expect, it } from "bun:test";
import { type ToolExecutionOptions, type ToolSet, tool } from "ai";
import { z } from "zod";
import { boundMcpTool } from "./bound-tool.ts";

type Execute = NonNullable<ToolSet[string]["execute"]>;

// Build a tool whose execute is exactly `execute` (or absent), mirroring the
// shape @ai-sdk/mcp hands the registry.
const makeTool = (execute?: Execute): ToolSet[string] =>
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous tool execute under test
  tool({ description: "t", inputSchema: z.object({}), execute: execute as any });

// Invoke a (bound) tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], opts: Partial<ToolExecutionOptions> = {}): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)({}, {
    toolCallId: "call-1",
    messages: [],
    ...opts,
  } as ToolExecutionOptions);

describe("boundMcpTool", () => {
  it("returns a tool with no execute unchanged", () => {
    const t = makeTool();
    expect(boundMcpTool(t)).toBe(t);
  });

  it("truncates an oversized result with a marker", async () => {
    const t = makeTool(async () => ({ content: [{ type: "text", text: "x".repeat(1000) }] }));
    const output = (await run(boundMcpTool(t, { maxBytes: 16 }))) as {
      content: { type: string; text: string }[];
    };
    expect(output.content).toHaveLength(1);
    expect(output.content[0].text).toBe(`${"x".repeat(16)}\n[truncated — result too large]`);
  });

  it("passes a small result through untouched, including non-text parts", async () => {
    const result = {
      content: [
        { type: "text", text: "hi" },
        { type: "image", data: "base64", mimeType: "image/png" },
        { type: "resource", uri: "file://x" },
      ],
    };
    const output = await run(
      boundMcpTool(
        makeTool(async () => result),
        { maxBytes: 1024 },
      ),
    );
    expect(output).toEqual(result);
  });

  it("forwards structuredContent in place of the duplicate content text", async () => {
    const data = { results: [{ id: 1, name: "a" }], count: 1 };
    const result = {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
      isError: false,
    };
    const output = await run(
      boundMcpTool(
        makeTool(async () => result),
        { maxBytes: 1024 },
      ),
    );
    expect(output).toEqual(data);
  });

  it("drops structuredContent and caps the text when the structured payload is too large", async () => {
    const result = {
      content: [{ type: "text", text: "z".repeat(1000) }],
      structuredContent: { blob: "y".repeat(1000) },
    };
    const output = (await run(
      boundMcpTool(
        makeTool(async () => result),
        { maxBytes: 16 },
      ),
    )) as Record<string, unknown> & { content: { type: string; text: string }[] };
    expect(output.content[0].text).toBe(`${"z".repeat(16)}\n[truncated — result too large]`);
    expect(output).not.toHaveProperty("structuredContent");
  });

  it("leaves a result with no content array untouched", async () => {
    const output = await run(boundMcpTool(makeTool(async () => "plain string")));
    expect(output).toBe("plain string");
  });

  it("aborts a call past its time budget with a tool error", async () => {
    const hangs = makeTool(
      (_input, opts) =>
        new Promise((_resolve, reject) => {
          opts.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal?.reason));
        }),
    );
    await expect(run(boundMcpTool(hangs, { timeoutMs: 20 }))).rejects.toThrow(/time budget/);
  });

  it("passes the caller's cancellation through", async () => {
    const hangs = makeTool(
      (_input, opts) =>
        new Promise((_resolve, reject) => {
          opts.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal?.reason));
        }),
    );
    const controller = new AbortController();
    const pending = run(boundMcpTool(hangs), { abortSignal: controller.signal });
    controller.abort(new Error("cancelled by user"));
    await expect(pending).rejects.toThrow("cancelled by user");
  });
});
