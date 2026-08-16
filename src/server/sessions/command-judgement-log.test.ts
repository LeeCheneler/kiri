import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CommandJudgementEvent,
  type CommandResolutionEvent,
  appendCommandEvent,
  readRecentCommandEvents,
  trimCommandLog,
} from "./command-judgement-log.ts";

const judgement = (overrides: Partial<CommandJudgementEvent> = {}): CommandJudgementEvent => ({
  type: "judgement",
  toolCallId: "call-1",
  command: "python3 fire_mc.py",
  cwd: "/work",
  verdict: "ask",
  reason: "unfamiliar script",
  source: "judge",
  at: "2026-08-16T10:00:00.000Z",
  ...overrides,
});

const resolution = (overrides: Partial<CommandResolutionEvent> = {}): CommandResolutionEvent => ({
  type: "resolution",
  toolCallId: "call-1",
  command: "python3 fire_mc.py",
  approved: true,
  at: "2026-08-16T10:01:00.000Z",
  ...overrides,
});

describe("command judgement log", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kiri-judgements-"));
    filePath = join(dir, ".kiri", "command-judgements.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one JSONL line per event, creating the directory", () => {
    appendCommandEvent(filePath, judgement());
    appendCommandEvent(filePath, resolution());
    const lines = readFileSync(filePath, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe("judgement");
    expect(JSON.parse(lines[1]).type).toBe("resolution");
  });

  it("reads back appended events oldest first", () => {
    appendCommandEvent(filePath, judgement({ toolCallId: "call-1" }));
    appendCommandEvent(filePath, resolution({ toolCallId: "call-1" }));
    appendCommandEvent(filePath, judgement({ toolCallId: "call-2" }));
    expect(readRecentCommandEvents(filePath, 10).map((e) => e.toolCallId)).toEqual([
      "call-1",
      "call-1",
      "call-2",
    ]);
  });

  it("returns only the last `limit` events", () => {
    for (let i = 0; i < 5; i++) {
      appendCommandEvent(filePath, judgement({ toolCallId: `call-${i}` }));
    }
    expect(readRecentCommandEvents(filePath, 2).map((e) => e.toolCallId)).toEqual([
      "call-3",
      "call-4",
    ]);
  });

  it("yields no events for a missing file", () => {
    expect(readRecentCommandEvents(filePath, 10)).toEqual([]);
  });

  it("warns and skips malformed and schema-failing lines", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      appendCommandEvent(filePath, judgement());
      writeFileSync(
        filePath,
        `${readFileSync(filePath, "utf8")}not json\n{"type":"judgement","bad":true}\n`,
      );
      appendCommandEvent(filePath, resolution());
      const events = readRecentCommandEvents(filePath, 10);
      expect(events.map((e) => e.type)).toEqual(["judgement", "resolution"]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores blank lines", () => {
    appendCommandEvent(filePath, judgement());
    writeFileSync(filePath, `${readFileSync(filePath, "utf8")}\n\n`);
    expect(readRecentCommandEvents(filePath, 10)).toHaveLength(1);
  });

  it("trims the log to the last `keep` events", () => {
    for (let i = 0; i < 5; i++) {
      appendCommandEvent(filePath, judgement({ toolCallId: `call-${i}` }));
    }
    trimCommandLog(filePath, 2);
    const kept = readRecentCommandEvents(filePath, 10);
    expect(kept.map((e) => e.toolCallId)).toEqual(["call-3", "call-4"]);
  });

  it("drops corrupt lines when trimming", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      appendCommandEvent(filePath, judgement());
      writeFileSync(filePath, `not json\n${readFileSync(filePath, "utf8")}`);
      trimCommandLog(filePath, 10);
      expect(readFileSync(filePath, "utf8").trimEnd().split("\n")).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("no-ops trimming a missing file", () => {
    trimCommandLog(filePath, 10);
    expect(existsSync(filePath)).toBe(false);
  });
});
