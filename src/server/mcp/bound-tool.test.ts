import { describe, expect, it, mock } from "bun:test";
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

describe("boundMcpTool", () => {
  it("returns a tool with no execute unchanged", () => {
    const t = makeTool();
    expect(boundMcpTool(t)).toBe(t);
  });

  it("truncates an oversized result with a marker", async () => {
    const t = makeTool(async () => ({ content: [{ type: "text", text: "x".repeat(1000) }] }));
    const output = (await run(boundMcpTool(t, { maxBytes: 128 }))) as {
      content: { type: string; text: string }[];
    };
    expect(output.content).toHaveLength(1);
    expect(output.content[0]?.text).toMatch(/^x+\n\[truncated — result too large\]$/);
    expect(Buffer.byteLength(JSON.stringify(output.content[0]))).toBeLessThanOrEqual(128);
  });

  it("passes a small result through untouched, including non-text parts", async () => {
    const result = {
      content: [
        { type: "text", text: "hi" },
        { type: "image", data: "AAAA", mimeType: "image/png" },
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

  it("deduplicates structuredContent without dropping its result envelope", async () => {
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
    expect(output).toEqual({ content: [], structuredContent: data, isError: false });
  });

  it("drops structuredContent and caps the text when the structured payload is too large", async () => {
    const result = {
      content: [{ type: "text", text: "z".repeat(1000) }],
      structuredContent: { blob: "y".repeat(1000) },
    };
    const output = (await run(
      boundMcpTool(
        makeTool(async () => result),
        { maxBytes: 128 },
      ),
    )) as Record<string, unknown> & { content: { type: string; text: string }[] };
    expect(output.content[0]?.text).toMatch(/^z+\n\[truncated — result too large\]$/);
    expect(Buffer.byteLength(JSON.stringify(output.content[0]))).toBeLessThanOrEqual(128);
    expect(output).not.toHaveProperty("structuredContent");
  });

  it("leaves a result with no content array untouched", async () => {
    const output = await run(boundMcpTool(makeTool(async () => "plain string")));
    expect(output).toBe("plain string");
  });

  describe("media and encoded result budgets", () => {
    const image = (bytes: number) => ({
      type: "image",
      data: Buffer.alloc(bytes).toString("base64"),
      mimeType: "image/png",
    });
    const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
    const bounded = (output: unknown, options = {}) =>
      run(
        boundMcpTool(
          makeTool(async () => output),
          options,
        ),
      );

    it("preserves an image larger than the text budget when it fits the media budgets", async () => {
      const result = { content: [image(1024)] };
      expect(await bounded(result, { maxBytes: 128 })).toEqual(result);
    });

    it("omits an image over the decoded media budget without cutting its base64", async () => {
      const result = { content: [image(1025)] };
      const output = await bounded(result, { maxImageBytes: 1024, maxResultBytes: 512 });
      expect(jsonBytes(output)).toBeLessThanOrEqual(512);
      expect(JSON.stringify(output)).toContain("omitted");
      expect(JSON.stringify(output)).not.toContain(result.content[0]?.data);
    });

    it("keeps useful images when accompanying text is truncated", async () => {
      const screenshot = image(64);
      const output = await bounded(
        { content: [{ type: "text", text: "x".repeat(1000) }, screenshot] },
        { maxBytes: 128 },
      );
      expect(output).toEqual(
        expect.objectContaining({ content: expect.arrayContaining([screenshot]) }),
      );
      expect(JSON.stringify(output)).toContain("truncated");
      expect(JSON.stringify(output)).not.toContain("x".repeat(1000));
    });

    it("keeps unique content and error flags alongside deduplicated structured content", async () => {
      const data = { ok: false };
      const screenshot = image(64);
      const result = {
        content: [
          { type: "text", text: JSON.stringify(data) },
          { type: "text", text: "independent explanation" },
          screenshot,
        ],
        structuredContent: data,
        isError: true,
      };
      const before = JSON.stringify(result);
      const output = await bounded(result);
      expect(output).toEqual({
        content: [{ type: "text", text: "independent explanation" }, screenshot],
        structuredContent: data,
        isError: true,
      });
      expect(JSON.stringify(result)).toBe(before);
    });

    it("bounds multiple individually valid images by the combined encoded budget", async () => {
      const screenshot = image(192);
      const result = { content: [screenshot, screenshot, screenshot] };
      const output = await bounded(result, { maxResultBytes: 512 });
      expect(jsonBytes(output)).toBeLessThanOrEqual(512);
      expect(JSON.stringify(output)).toContain("omitted");
      expect(output).toEqual(
        expect.objectContaining({ content: expect.arrayContaining([screenshot]) }),
      );
    });

    it("counts unknown fields and non-content outputs without guessing which strings are images", async () => {
      for (const result of [
        { screenshot: "A".repeat(2048) },
        "A".repeat(2048),
        { content: [], _meta: { image: "A".repeat(2048) } },
        { content: [{ type: "resource", resource: { blob: "A".repeat(2048) } }] },
      ]) {
        const output = await bounded(result, { maxBytes: 128, maxResultBytes: 512 });
        expect(jsonBytes(output)).toBeLessThanOrEqual(512);
        expect(JSON.stringify(output)).toMatch(/omitted|truncated/);
        expect(JSON.stringify(output)).not.toContain("A".repeat(2048));
      }
    });

    it("bounds aggregate encoded text including JSON escaping and metadata", async () => {
      const output = (await bounded(
        {
          content: [
            { type: "text", text: '"\\\n😀'.repeat(100) },
            { type: "text", text: "extra".repeat(100) },
          ],
          _meta: { trace: "ok" },
        },
        { maxBytes: 128 },
      )) as { content: { type: string; text: string }[]; _meta: unknown };
      const dataParts = output.content.filter((part) => !part.text.includes("omitted"));
      const bytes = dataParts.reduce(
        (sum, part) => sum + jsonBytes(part),
        jsonBytes({ _meta: output._meta }) - 2,
      );
      expect(bytes).toBeLessThanOrEqual(128);
      expect(output.content[0]?.text).toContain("truncated");
      expect(output.content[0]?.text).not.toContain("�");
      expect(output.content[0]?.text).not.toMatch(/[\uD800-\uDBFF]\n/);
    });

    it("marks malformed protocol images instead of forwarding invalid visual input", async () => {
      for (const part of [
        { type: "image" },
        { type: "image", data: 1, mimeType: "image/png" },
        { type: "image", data: "AAAA", mimeType: "text/plain" },
        { type: "image", data: "AAA!", mimeType: "image/png" },
        { type: "image", data: "AAA", mimeType: "image/png" },
      ]) {
        const output = await bounded({ content: [part] });
        expect(JSON.stringify(output)).toContain("omitted");
        expect(output).not.toEqual({ content: [part] });
      }
    });

    it("preserves error status when large metadata or structured data cannot fit the combined result", async () => {
      for (const result of [
        { content: [image(1024)], structuredContent: { value: "x".repeat(200) }, isError: true },
        { content: [], _meta: "x".repeat(500), isError: true },
        { content: [image(1024)], structuredContent: { value: "x".repeat(140) }, isError: true },
      ]) {
        const output = await bounded(result, {
          maxBytes: 1024,
          maxImageBytes: 1,
          maxResultBytes: 256,
        });
        expect(jsonBytes(output)).toBeLessThanOrEqual(256);
        expect(output).toEqual(expect.objectContaining({ isError: true }));
        expect(JSON.stringify(output)).toContain("omitted");
      }
    });

    it("bounds plain output even when the text budget exceeds the encoded result budget", async () => {
      const output = await bounded("x".repeat(1000), { maxBytes: 1024, maxResultBytes: 256 });
      expect(jsonBytes(output)).toBeLessThanOrEqual(256);
      expect(JSON.stringify(output)).toContain("truncated");
    });

    it("handles zero text and image budgets without an unbounded notice per item", async () => {
      const result = {
        content: [image(4), ...Array.from({ length: 1000 }, () => ({ type: "text", text: "x" }))],
      };
      const output = await bounded(result, { maxBytes: 0, maxImageBytes: 0, maxResultBytes: 256 });
      expect(jsonBytes(output)).toBeLessThanOrEqual(256);
      expect(output).toEqual(
        expect.objectContaining({
          content: [expect.objectContaining({ text: expect.stringContaining("omitted") })],
        }),
      );
    });

    it("reserves room for an omission notice by releasing the last retained content when necessary", async () => {
      const screenshot = image(64);
      const result = { content: [screenshot, screenshot, screenshot, { type: "image" }] };
      const output = (await bounded(result, { maxResultBytes: 512 })) as { content: unknown[] };
      expect(jsonBytes(output)).toBeLessThanOrEqual(512);
      expect(output.content).toEqual([
        screenshot,
        screenshot,
        expect.objectContaining({ text: expect.stringContaining("omitted") }),
      ]);
    });

    it("enforces the production media and combined limits using actual encoded payloads", async () => {
      const allowed = { content: [image(10 * 1024 * 1024)] };
      expect(await bounded(allowed)).toEqual(allowed);
      const oversized = await bounded({ content: [image(10 * 1024 * 1024 + 1)] });
      expect(JSON.stringify(oversized)).toContain("omitted");
      const screenshot = image(5 * 1024 * 1024);
      const combined = (await bounded({ content: [screenshot, screenshot, screenshot] })) as {
        content: unknown[];
      };
      expect(jsonBytes(combined)).toBeLessThanOrEqual(15 * 1024 * 1024);
      expect(combined.content).toEqual([
        screenshot,
        screenshot,
        expect.objectContaining({ text: expect.stringContaining("omitted") }),
      ]);
    });

    it("rejects nonsensical test budgets rather than exceeding them", async () => {
      for (const options of [
        { maxResultBytes: 255 },
        { maxResultBytes: 256.5 },
        { maxBytes: -1 },
        { maxBytes: 0.5 },
        { maxImageBytes: -1 },
        { maxImageBytes: 0.5 },
      ]) {
        await expect(bounded({ content: [] }, options)).rejects.toThrow(RangeError);
      }
    });

    it("accepts exactly the decoded image limit and rejects one byte more", async () => {
      const allowed = { content: [image(3)] };
      expect(await bounded(allowed, { maxImageBytes: 3 })).toEqual(allowed);
      expect(
        JSON.stringify(await bounded({ content: [image(4)] }, { maxImageBytes: 3 })),
      ).toContain("omitted");
    });

    it("accepts exactly the combined encoded limit and bounds the next byte", async () => {
      const result = { content: [image(192)] };
      const size = jsonBytes(result);
      expect(await bounded(result, { maxResultBytes: size })).toEqual(result);
      const output = await bounded(result, { maxResultBytes: size - 1 });
      expect(jsonBytes(output)).toBeLessThanOrEqual(size - 1);
      expect(JSON.stringify(output)).toContain("omitted");
    });
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

  it("settles at its deadline even when execute ignores the abort signal", async () => {
    const hangs = makeTool(() => new Promise(() => {}));
    await expect(within(run(boundMcpTool(hangs, { timeoutMs: 20 })))).rejects.toThrow(
      /time budget/,
    );
  });

  it("settles on cancellation even when execute ignores the abort signal", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled by user");
    const started = Promise.withResolvers<void>();
    const pending = run(
      boundMcpTool(
        makeTool(() => {
          started.resolve();
          return new Promise(() => {});
        }),
      ),
      { abortSignal: controller.signal },
    );
    await started.promise;
    controller.abort(reason);
    await expect(within(pending)).rejects.toBe(reason);
  });

  it("does not start an already-cancelled call", async () => {
    const original = mock(async () => "not run");
    const reason = new Error("already cancelled");
    await expect(
      run(boundMcpTool(makeTool(original)), {
        abortSignal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
    expect(original).not.toHaveBeenCalled();
  });

  it("cleans up after a successful call and preserves its result after later cancellation", async () => {
    const controller = new AbortController();
    const remove = mock(controller.signal.removeEventListener.bind(controller.signal));
    controller.signal.removeEventListener = remove;
    let requestSignal: AbortSignal | undefined;
    const result = await run(
      boundMcpTool(
        makeTool(async (_input, opts) => {
          requestSignal = opts.abortSignal;
          return "completed";
        }),
        { timeoutMs: 20 },
      ),
      { abortSignal: controller.signal },
    );
    controller.abort();
    expect(result).toBe("completed");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    // Advance beyond the former deadline to prove the timer was cleared too.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(requestSignal?.aborted).toBe(false);
  });

  it("preserves ordinary synchronous and asynchronous tool failures", async () => {
    const reason = new Error("tool failed");
    for (const original of [
      () => {
        throw reason;
      },
      async () => {
        throw reason;
      },
    ]) {
      await expect(run(boundMcpTool(makeTool(original)))).rejects.toBe(reason);
    }
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a late %s after cancellation",
    async (ending) => {
      const started = Promise.withResolvers<void>();
      const result = Promise.withResolvers<unknown>();
      const controller = new AbortController();
      const reason = new Error("cancelled first");
      const pending = run(
        boundMcpTool(
          makeTool(() => {
            started.resolve();
            return result.promise;
          }),
        ),
        { abortSignal: controller.signal },
      );
      await started.promise;
      controller.abort(reason);
      await expect(within(pending)).rejects.toBe(reason);
      if (ending === "resolve") result.resolve("too late");
      else result.reject(new Error("late failure"));
      await expect(pending).rejects.toBe(reason);
    },
  );

  it("keeps a timeout outcome when the caller cancels afterwards", async () => {
    const controller = new AbortController();
    const pending = run(
      boundMcpTool(
        makeTool(() => new Promise(() => {})),
        { timeoutMs: 20 },
      ),
      {
        abortSignal: controller.signal,
      },
    );
    await expect(within(pending)).rejects.toThrow(/time budget/);
    controller.abort(new Error("cancelled later"));
    await expect(pending).rejects.toThrow(/time budget/);
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
