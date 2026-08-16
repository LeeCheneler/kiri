import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmClients } from "../llm/index.ts";
import { readRecentCommandEvents } from "./command-judgement-log.ts";
import { type CommandLearning, createCommandLearning } from "./command-learning.ts";

describe("createCommandLearning", () => {
  let dir: string;
  let logFile: string;
  let guidanceFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-learning-"));
    mkdirSync(join(dir, ".kiri"));
    logFile = join(dir, ".kiri", "command-judgements.jsonl");
    guidanceFile = join(dir, ".kiri", "command-guidance.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const judgement = (toolCallId: string) => ({
    toolCallId,
    command: "python3 fire_mc.py",
    cwd: "/work",
    verdict: "ask" as const,
    reason: "unfamiliar script",
    source: "judge" as const,
  });

  const learning = (
    respond: (options: { prompt: string }) => string,
    overrides: { getModel?: () => string | undefined } = {},
  ): { learning: CommandLearning; calls: string[] } => {
    const calls: string[] = [];
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: async (options) => {
        calls.push(options.prompt);
        return { text: respond(options), usage: {} };
      },
    };
    return {
      calls,
      learning: createCommandLearning({
        llmClients: clients,
        getModel: overrides.getModel ?? (() => "openai:gpt-mini"),
        logFile,
        guidanceFile,
        debounceMs: 0,
      }),
    };
  };

  it("appends recorded judgements and resolutions to the log", async () => {
    const { learning: loop } = learning(() => "NONE");
    loop.recordJudgement(judgement("call-1"));
    loop.recordResolution({ toolCallId: "call-1", command: "python3 fire_mc.py", approved: true });
    await loop.flush();
    const events = readRecentCommandEvents(logFile, 10);
    expect(events.map((e) => e.type)).toEqual(["judgement", "resolution"]);
    for (const event of events) {
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }
  });

  it("folds a burst of records into one distillation", async () => {
    const { learning: loop, calls } = learning(() => "- rules");
    loop.recordJudgement(judgement("call-1"));
    loop.recordJudgement(judgement("call-2"));
    loop.recordJudgement(judgement("call-3"));
    await loop.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("call-3");
  });

  it("writes the distilled guidance atomically and reads it back", async () => {
    const { learning: loop } = learning(() => "- approves fire_mc.py runs");
    loop.recordJudgement(judgement("call-1"));
    await loop.flush();
    expect(readFileSync(guidanceFile, "utf8")).toBe("- approves fire_mc.py runs");
    expect(existsSync(`${guidanceFile}.tmp`)).toBe(false);
    expect(loop.guidance()).toBe("- approves fire_mc.py runs");
  });

  it("trims the log after a successful distillation", async () => {
    const { learning: loop } = learning(() => "- rules");
    for (let i = 0; i < 205; i++) {
      loop.recordJudgement(judgement(`call-${i}`));
    }
    await loop.flush();
    expect(readRecentCommandEvents(logFile, 500)).toHaveLength(200);
  });

  it("keeps the old guidance and the full log when distillation fails", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeFileSync(guidanceFile, "- old rules");
      const { learning: loop } = learning(() => {
        throw new Error("provider down");
      });
      loop.recordJudgement(judgement("call-1"));
      await loop.flush();
      expect(readFileSync(guidanceFile, "utf8")).toBe("- old rules");
      expect(readRecentCommandEvents(logFile, 10)).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("logs events but never distills without a utility model", async () => {
    const { learning: loop, calls } = learning(() => "- rules", {
      getModel: () => undefined,
    });
    loop.recordJudgement(judgement("call-1"));
    await loop.flush();
    expect(calls).toHaveLength(0);
    expect(readRecentCommandEvents(logFile, 10)).toHaveLength(1);
    expect(existsSync(guidanceFile)).toBe(false);
  });

  it("does not distill an empty log", async () => {
    const { learning: loop, calls } = learning(() => "- rules");
    await loop.flush();
    expect(calls).toHaveLength(0);
  });

  it("runs one distillation at a time and reruns for events landing mid-flight", async () => {
    const calls: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const clients: Pick<LlmClients, "generateText"> = {
      generateText: async (options) => {
        calls.push(options.prompt);
        if (calls.length === 1) await gate;
        return { text: "- rules", usage: {} };
      },
    };
    const loop = createCommandLearning({
      llmClients: clients,
      getModel: () => "openai:gpt-mini",
      logFile,
      guidanceFile,
      debounceMs: 0,
    });
    loop.recordJudgement(judgement("call-1"));
    const flushed = loop.flush();
    // Let the first distillation start, then land a resolution mid-flight.
    await Bun.sleep(1);
    loop.recordResolution({ toolCallId: "call-1", command: "python3 fire_mc.py", approved: true });
    await Bun.sleep(1);
    release();
    await flushed;
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain('"resolution"');
    expect(calls[1]).toContain('"resolution"');
  });

  it("reads guidance fresh from disk on every call", async () => {
    const { learning: loop } = learning(() => "- rules");
    expect(loop.guidance()).toBe("");
    writeFileSync(guidanceFile, "- hand-checked rules");
    expect(loop.guidance()).toBe("- hand-checked rules");
  });
});
