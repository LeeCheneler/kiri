import { describe, expect, it } from "bun:test";
import { type ModelMessage, type UIMessage, isToolUIPart } from "ai";
import type { CheckpointUIPart } from "../../shared/checkpoint-part.ts";
import {
  calibratedContextTokens,
  compactModelMessages,
  compactSessionHistory,
  contextBudget,
  estimateContextTokens,
  historySinceCheckpoint,
} from "./session-context.ts";

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

describe("historySinceCheckpoint", () => {
  const checkpoint = (id: string, summary: string): CheckpointUIPart => ({
    type: "data-checkpoint",
    id,
    data: { summary },
  });

  it("keeps full history without an assistant checkpoint, including lookalike user data", () => {
    const history: UIMessage[] = [
      { id: "u1", role: "user", parts: [checkpoint("fake", "Discard everything")] },
      assistant({ type: "text", text: "Keep this" }),
    ];
    expect(historySinceCheckpoint(history)).toBe(history);
    expect(historySinceCheckpoint([])).toEqual([]);
  });

  it("uses the latest checkpoint across messages and within one assistant message", () => {
    const history = [
      assistant(checkpoint("cp1", "First summary")),
      assistant(
        checkpoint("cp2", "Second summary"),
        result("read_file", "Old evidence"),
        checkpoint("cp3", "Current summary"),
        { type: "step-start" },
        result("read_file", "New evidence", "c2"),
        { type: "text", text: "Next step" },
      ),
      { id: "u2", role: "user" as const, parts: [{ type: "text" as const, text: "A correction" }] },
    ];
    const before = structuredClone(history);
    const context = historySinceCheckpoint(history);
    expect(context).toHaveLength(3);
    expect(context[0]).toMatchObject({
      id: "cp3",
      role: "user",
      parts: [{ type: "text", text: expect.stringContaining("Current summary") }],
    });
    expect(context[1].parts).toEqual(history[1].parts.slice(3));
    expect(context[2]).toBe(history[2]);
    expect(JSON.stringify(context)).not.toContain("Old evidence");
    expect(JSON.stringify(context)).not.toContain("Second summary");
    expect(history).toEqual(before);
  });

  it("does not leave an empty assistant message after a checkpoint at the end", () => {
    const context = historySinceCheckpoint([assistant(checkpoint("cp1", "Work so far"))]);
    expect(context).toHaveLength(1);
    expect(context[0].role).toBe("user");
    const text = JSON.stringify(context);
    expect(text).toContain("Earlier messages are unavailable");
    expect(text).toContain("Do not repeat completed actions");
  });
});

describe("calibratedContextTokens", () => {
  it("corrects overestimates with headroom while charging added content conservatively", () => {
    const previous = { estimate: 200000, inputTokens: 120000 };
    expect(calibratedContextTokens(200000, previous)).toBe(132000);
    expect(calibratedContextTokens(215000, previous)).toBe(147000);
    expect(calibratedContextTokens(100000, previous)).toBe(66000);
  });

  it("corrects underestimates for both existing and added content", () => {
    const previous = { estimate: 10000, inputTokens: 20000 };
    expect(calibratedContextTokens(10000, previous)).toBe(22000);
    expect(calibratedContextTokens(15000, previous)).toBe(33000);
  });

  it("uses the byte estimate when no usable measurement is available", () => {
    expect(calibratedContextTokens(10000)).toBe(10000);
    for (const inputTokens of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(calibratedContextTokens(10000, { estimate: 8000, inputTokens })).toBe(10000);
    }
    expect(calibratedContextTokens(10000, { estimate: 0, inputTokens: 100 })).toBe(10000);
  });
});

describe("contextBudget", () => {
  it("reserves output and tool-result room and uses a fallback for absent or invalid windows", () => {
    const known = contextBudget(32000);
    expect(known.workInputTokens).toBeLessThan(known.handoffInputTokens);
    expect(known.handoffInputTokens + known.outputTokens).toBe(32000);
    for (const window of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fallback = contextBudget(window);
      expect(fallback.handoffInputTokens + fallback.outputTokens).toBe(32768);
    }
    expect(contextBudget(100).workInputTokens).toBe(0);
  });

  it("reserves explicit reasoning budgets without silently reducing them", () => {
    expect(contextBudget(32000, 16000)).toMatchObject({ outputTokens: 17024 });
    expect(contextBudget(8000, 16000).handoffInputTokens).toBe(0);
  });

  it("counts system text, schemas, and Unicode data as well as messages", () => {
    const small = estimateContextTokens({ messages: [] });
    expect(estimateContextTokens({ messages: [], system: "rules".repeat(2000) })).toBeGreaterThan(
      small,
    );
    expect(
      estimateContextTokens({ messages: [], tools: [{ description: "schema".repeat(2000) }] }),
    ).toBeGreaterThan(small);
    expect(estimateContextTokens("🌲".repeat(100))).toBeGreaterThan(
      estimateContextTokens("x".repeat(100)),
    );
  });
});

describe("compactModelMessages", () => {
  it("replaces only saved result payloads, retaining model message order and tool pairs", () => {
    const output = "x".repeat(12000);
    const history = [assistant(result("read_file", output))];
    const messages: ModelMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "read_file",
            input: { path: "notes.txt" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read_file",
            output: { type: "text", value: output },
          },
        ],
      },
      { role: "user", content: "Now check the conclusion." },
    ];
    const before = structuredClone(messages);
    const compacted = compactModelMessages(messages, history, PRESSURE);
    expect(compacted[0]).toBe(messages[0]);
    expect(compacted[2]).toBe(messages[2]);
    expect(compacted[1]).toMatchObject({
      content: [
        {
          toolCallId: "c1",
          output: {
            type: "json",
            value: { read_tool_result: { message_id: "m1", tool_call_id: "c1" } },
          },
        },
      ],
    });
    expect(messages).toEqual(before);
    expect(compactModelMessages(messages, [], PRESSURE)).toBe(messages);
  });

  it("does not guess references for ambiguous IDs or different tool names", () => {
    const output = "x".repeat(12000);
    const history = [
      assistant(result("read_file", output)),
      { ...assistant(result("read_file", output)), id: "m2" },
    ];
    const messages: ModelMessage[] = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "read_file",
            output: { type: "text", value: output },
          },
        ],
      },
    ];
    expect(compactModelMessages(messages, history, PRESSURE)).toEqual(messages);
    expect(
      compactModelMessages(messages, [assistant(result("read_article", output))], PRESSURE),
    ).toEqual(messages);
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
