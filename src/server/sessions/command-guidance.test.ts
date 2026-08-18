import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmClients } from "../llm/index.ts";
import {
  COMMAND_GUIDANCE_PROMPT_PREFIX,
  distillCommandGuidance,
  readCommandGuidance,
} from "./command-guidance.ts";
import type { CommandEvent } from "./command-judgement-log.ts";

const fakeClients = (
  respond: (options: { model: string; prompt: string; abortSignal?: AbortSignal }) => string,
): Pick<LlmClients, "generateText"> => ({
  generateText: async (options) => ({ text: respond(options), usage: {} }),
});

const events: CommandEvent[] = [
  {
    type: "judgement",
    toolCallId: "call-1",
    command: "python3 fire_mc.py",
    cwd: "/work",
    verdict: "ask",
    reason: "unfamiliar script",
    source: "judge",
    at: "2026-08-16T10:00:00.000Z",
  },
  {
    type: "resolution",
    toolCallId: "call-1",
    command: "python3 fire_mc.py",
    approved: true,
    at: "2026-08-16T10:01:00.000Z",
  },
];

const distill = (
  respond: (options: { prompt: string }) => string,
  previousGuidance = "- approves worktree helpers",
) =>
  distillCommandGuidance({
    llmClients: fakeClients(respond),
    model: "openai:gpt-mini",
    previousGuidance,
    events,
  });

describe("readCommandGuidance", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-guidance-"));
    filePath = join(dir, "command-guidance.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("yields empty for a missing file", () => {
    expect(readCommandGuidance(filePath)).toBe("");
  });

  it("reads and trims the file", () => {
    writeFileSync(filePath, "- approves fire_mc.py runs\n");
    expect(readCommandGuidance(filePath)).toBe("- approves fire_mc.py runs");
  });

  it("caps a runaway file so the judge prompt stays bounded", () => {
    writeFileSync(filePath, "x".repeat(10_000));
    expect(readCommandGuidance(filePath)).toHaveLength(4000);
  });
});

describe("distillCommandGuidance", () => {
  it("sends the previous rules and each decision to the model", async () => {
    let prompt = "";
    await distill((options) => {
      prompt = options.prompt;
      return "- rules";
    });
    expect(prompt).toStartWith(COMMAND_GUIDANCE_PROMPT_PREFIX);
    expect(prompt).toContain("Current rules:\n- approves worktree helpers");
    for (const event of events) {
      expect(prompt).toContain(JSON.stringify(event));
    }
  });

  it("marks absent previous rules rather than sending an empty section", async () => {
    let prompt = "";
    await distill((options) => {
      prompt = options.prompt;
      return "- rules";
    }, "");
    expect(prompt).toContain("Current rules:\n(none)");
  });

  it("returns the trimmed reply as the new content", async () => {
    expect(await distill(() => "\n- approves fire_mc.py runs\n")).toBe(
      "- approves fire_mc.py runs",
    );
  });

  it("maps an abstaining NONE reply to empty content", async () => {
    expect(await distill(() => "NONE")).toBe("");
    expect(await distill(() => "none\n")).toBe("");
  });

  it("strips a wrapping code fence", async () => {
    expect(await distill(() => "```markdown\n- approves fire_mc.py runs\n```")).toBe(
      "- approves fire_mc.py runs",
    );
  });

  it("truncates an over-budget reply", async () => {
    expect(await distill(() => "x".repeat(10_000))).toHaveLength(4000);
  });

  it("returns null and warns when the model call rejects", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await distillCommandGuidance({
        llmClients: {
          generateText: async () => {
            throw new Error("provider down");
          },
        },
        model: "openai:gpt-mini",
        previousGuidance: "",
        events,
      });
      expect(result).toBeNull();
      expect(warn.mock.calls[0]?.[0]).toContain(
        "command guidance distillation failed: provider down",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("returns null when the distillation exceeds its timeout", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const clients: Pick<LlmClients, "generateText"> = {
        generateText: ({ abortSignal }) =>
          new Promise((_resolve, reject) => {
            abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
          }),
      };
      const result = await distillCommandGuidance({
        llmClients: clients,
        model: "openai:gpt-mini",
        previousGuidance: "",
        events,
        timeoutMs: 5,
      });
      expect(result).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});
