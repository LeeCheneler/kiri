import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import {
  historyProjectionTools,
  projectToolOutput,
  toolModelOutput,
} from "./tool-output-projection.ts";

const records = {
  results: [
    { id: 1, name: "alpha", score: 10 },
    { id: 2, name: "beta", score: 20 },
    { id: 3, name: "gamma", score: 30 },
  ],
};

describe("projectToolOutput", () => {
  it("drops the diff a write tool's result carries, keeping its metadata", () => {
    const output = { path: "/a.txt", created: false, diff: "@@ -1 +1 @@", diffTruncated: true };

    expect(projectToolOutput("write_file", output)).toEqual({ path: "/a.txt", created: false });
    expect(projectToolOutput("save_memory", output)).toEqual({ path: "/a.txt", created: false });
  });

  it("drops the image a generated image's result carries, keeping its metadata", () => {
    const output = { model: "test:paint", image: "data:image/png;base64,AAAA" };

    expect(projectToolOutput("generate_image", output)).toEqual({ model: "test:paint" });
  });

  it("leaves a tool that declares no payload, and one kiri doesn't know, untouched", () => {
    // A field that happens to be called `diff` belongs to the tool's own result.
    const output = { diff: "kept", image: "kept" };

    expect(projectToolOutput("read_file", output)).toBe(output);
    expect(projectToolOutput("linear__search", output)).toBe(output);
  });
});

describe("toolModelOutput", () => {
  it("sends a string result as text", () => {
    expect(toolModelOutput("use_skill", "the skill body")).toEqual({
      type: "text",
      value: "the skill body",
    });
  });

  it("sends anything else as JSON", () => {
    expect(toolModelOutput("linear__search", records)).toEqual({ type: "json", value: records });
    expect(toolModelOutput("read_file", 3)).toEqual({ type: "json", value: 3 });
    expect(toolModelOutput("read_file", undefined)).toEqual({ type: "json", value: null });
  });

  it("strips the declared payload from what is sent", () => {
    expect(toolModelOutput("replace_article", { ...records, diff: "@@ -1 +1 @@" })).toEqual({
      type: "json",
      value: records,
    });
  });
});

describe("historyProjectionTools", () => {
  const history: UIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "go" }] },
    {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "text", text: "working" },
        {
          type: "tool-write_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "/a.txt" },
          output: { path: "/a.txt", diff: "@@" },
        },
        {
          type: "dynamic-tool",
          toolName: "linear__search",
          toolCallId: "c2",
          state: "output-available",
          input: {},
          output: records,
        },
        { type: "tool-write_file", toolCallId: "c3", state: "input-available", input: {} },
      ] as UIMessage["parts"],
    },
  ];

  it("carries one projection per tool the history names, built-in or MCP", () => {
    expect(Object.keys(historyProjectionTools(history)).sort()).toEqual([
      "linear__search",
      "write_file",
    ]);
  });

  it("projects a result by the name it was recorded under", async () => {
    const hooks = historyProjectionTools(history);
    const call = { toolCallId: "c1", input: {} };

    expect(
      await hooks.write_file?.toModelOutput?.({ ...call, output: { path: "/a.txt", diff: "@@" } }),
    ).toEqual(toolModelOutput("write_file", { path: "/a.txt", diff: "@@" }));
    expect(await hooks.linear__search?.toModelOutput?.({ ...call, output: records })).toEqual(
      toolModelOutput("linear__search", records),
    );
  });

  it("gives a hook nothing to execute", () => {
    for (const hook of Object.values(historyProjectionTools(history))) {
      expect(hook.execute).toBeUndefined();
    }
  });
});
