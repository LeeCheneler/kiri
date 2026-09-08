import { describe, expect, it } from "bun:test";
import { type UIMessage, isToolUIPart } from "ai";
import { compactSessionHistory, currentContextTokens } from "./session-context.ts";
import type { Message } from "./store.ts";

const result = (name: string, output: unknown, id = "c1"): UIMessage["parts"][number] => ({
  type: "dynamic-tool",
  toolName: name,
  toolCallId: id,
  state: "output-available",
  input: { path: "notes.txt" },
  output,
});

const assistant = (...parts: UIMessage["parts"]): UIMessage => ({
  id: "m1",
  role: "assistant",
  parts,
});
const PRESSURE = { tokensToSave: 1000, recoveryAvailable: true };

describe("currentContextTokens", () => {
  it("uses the latest available footprint and leaves missing usage unknown", () => {
    const rows = [12, null, 34, null].map((contextTokens) => ({ contextTokens }) as Message);
    expect(currentContextTokens(rows)).toBe(34);
    expect(currentContextTokens([])).toBeUndefined();
    expect(currentContextTokens([{ contextTokens: null } as Message])).toBeUndefined();
  });
});

describe("compactSessionHistory", () => {
  it("keeps history unchanged without pressure or a recovery tool", () => {
    const history = [assistant(result("read_file", "x".repeat(12000)))];
    for (const options of [
      { tokensToSave: 0, recoveryAvailable: true },
      { tokensToSave: -100, recoveryAvailable: true },
      { tokensToSave: 1000, recoveryAvailable: false },
    ])
      expect(compactSessionHistory(history, options)).toBe(history);
  });

  it("retains a partial excerpt, recoverable identity, and original invocation", () => {
    const original = `Evidence begins here.\n${"x".repeat(12000)}`;
    const history = [assistant(result("read_file", original))];
    const before = structuredClone(history);
    const compacted = compactSessionHistory(history, PRESSURE);
    const part = compacted[0]?.parts[0];
    if (!part || !isToolUIPart(part) || part.state !== "output-available")
      throw new Error("Missing result");
    expect(part.input).toEqual({ path: "notes.txt" });
    expect(part.toolCallId).toBe("c1");
    expect(part.output).toMatchObject({
      context_compacted: true,
      read_tool_result: { message_id: "m1", tool_call_id: "c1" },
      original_length: original.length,
      format: "text",
      excerpt: original.slice(0, 2000),
    });
    expect(JSON.stringify(compacted).length).toBeLessThan(JSON.stringify(history).length);
    expect(history).toEqual(before);
  });

  it("compacts structured evidence and stops once enough space is recovered", () => {
    const history = [
      assistant(
        result("search_files", { matches: "x".repeat(12000) }),
        result("read_article", "later evidence".repeat(1000), "c2"),
      ),
    ];
    const compacted = compactSessionHistory(history, PRESSURE);
    expect(compacted[0]?.parts[0]).toMatchObject({
      output: { format: "json", context_compacted: true },
    });
    expect(compacted[0]?.parts[1]).toBe(history[0]?.parts[1]);
    expect(compactSessionHistory(compacted, PRESSURE)[0]?.parts[0]).toBe(compacted[0]?.parts[0]);
  });

  it("keeps every small result regardless of its age or the number of tool calls", () => {
    const history = [
      assistant(
        ...Array.from({ length: 10 }, (_, i) => result("read_file", `result ${i}`, `c${i}`)),
      ),
    ];
    expect(compactSessionHistory(history, PRESSURE)).toBe(history);
  });

  it("preserves skills, action outcomes, task state, recovery pages, and unknown tools", () => {
    const protectedNames = [
      "use_skill",
      "run_command",
      "write_file",
      "run_workflow",
      "delegate",
      "list_tasks",
      "read_tool_result",
      "remote__search",
    ];
    const history = [
      assistant(...protectedNames.map((name) => result(name, "important ".repeat(2000), name))),
    ];
    expect(compactSessionHistory(history, { ...PRESSURE, tokensToSave: 100000 })).toBe(history);
  });

  it("preserves user decisions, assistant plans, worker reports, and instruction receipts", () => {
    const user: UIMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Keep the existing API. ".repeat(1000) }],
    };
    const text: UIMessage["parts"][number] = {
      type: "text",
      text: "Completed the edit; tests remain.",
    };
    const receipt: UIMessage["parts"][number] = {
      type: "data-instructions",
      data: { targets: ["/repo"] },
    };
    const report: UIMessage["parts"][number] = {
      type: "data-inbox",
      data: { text: "Worker findings", source: "worker" },
    };
    const history = [
      user,
      assistant(text, receipt, report, result("read_file", "x".repeat(12000))),
    ];
    const compacted = compactSessionHistory(history, PRESSURE);
    expect(compacted[0]).toBe(user);
    expect(compacted[1]?.parts.slice(0, 3)).toEqual([text, receipt, report]);
  });

  it("leaves pending, denied, and errored calls intact", () => {
    const history = [
      assistant(
        {
          type: "tool-read_file",
          toolCallId: "c1",
          state: "input-available",
          input: { path: "file" },
        },
        {
          type: "tool-read_file",
          toolCallId: "c2",
          state: "output-error",
          input: { path: "file" },
          errorText: "error".repeat(3000),
        },
        {
          type: "tool-read_file",
          toolCallId: "c3",
          state: "approval-requested",
          input: { path: "file" },
          approval: { id: "p1" },
        },
        {
          type: "tool-read_file",
          toolCallId: "c4",
          state: "output-denied",
          input: { path: "file" },
          approval: { id: "p2", approved: false },
        },
      ),
    ];
    expect(compactSessionHistory(history, PRESSURE)).toBe(history);
  });

  it("keeps absent, empty, and null payloads", () => {
    const history = [
      assistant(result("read_file", undefined), result("read_file", ""), result("read_file", null)),
    ];
    expect(compactSessionHistory(history, PRESSURE)).toBe(history);
  });
});
