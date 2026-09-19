import { describe, expect, it } from "bun:test";
import {
  CURRENT_PARTS_FORMAT,
  LEGACY_PARTS_FORMAT,
  TranscriptFormatError,
  readStoredParts,
} from "./transcript-format.ts";

const inbox = {
  type: "data-inbox",
  id: "inbox-1",
  data: { source: "child", text: "done", fromSessionId: "worker", queuedAt: 1 },
};

// One of every kind of part a turn persists, as the column holds them.
const stored = [
  { type: "text", text: "Here is the file." },
  { type: "file", mediaType: "image/png", filename: "a.png", url: "data:image/png;base64,AA==" },
  {
    type: "tool-run_command",
    toolCallId: "call-1",
    state: "approval-requested",
    input: { command: "ls" },
    approval: { id: "approval-1" },
  },
  {
    type: "tool-run_command",
    toolCallId: "call-2",
    state: "approval-responded",
    input: { command: "pwd" },
    approval: { id: "approval-2", approved: true },
  },
  inbox,
  {
    type: "data-checkpoint",
    id: "checkpoint-1",
    data: {
      summary: "So far.",
      pendingMessages: [{ id: "m2", role: "user", parts: [{ type: "text", text: "next" }] }],
    },
  },
  {
    type: "data-instructions",
    data: {
      workspace: "w",
      project: "p",
      directories: [{ directory: "/repo", digest: "d" }],
      targets: [{ directory: "/repo", scope: "filesystem", recursive: true }],
    },
  },
  {
    type: "data-context-calibration",
    data: { version: 2, model: "fake:echo", optionsHash: "h", estimate: 10, inputTokens: 12 },
  },
];

describe("readStoredParts", () => {
  it("reads a legacy row's parts unchanged", () => {
    expect(readStoredParts("m1", LEGACY_PARTS_FORMAT, stored)).toBe(stored as never);
  });

  it("reads a current row's parts unchanged", () => {
    expect(readStoredParts("m1", CURRENT_PARTS_FORMAT, stored)).toBe(stored as never);
  });

  it("keeps a part type this build does not know", () => {
    const parts = [{ type: "tool-removed_tool", toolCallId: "c", state: "output-available" }];
    expect(readStoredParts("m1", LEGACY_PARTS_FORMAT, parts)).toBe(parts as never);
  });

  it("keeps a calibration written under an earlier payload version", () => {
    const parts = [{ type: "data-context-calibration", data: { version: 1, inputTokens: 5 } }];
    expect(readStoredParts("m1", LEGACY_PARTS_FORMAT, parts)).toBe(parts as never);
  });

  it("rejects a format newer than this build writes", () => {
    expect(() => readStoredParts("m1", CURRENT_PARTS_FORMAT + 1, stored)).toThrow(
      new TranscriptFormatError(
        "m1",
        `it was written in parts format ${CURRENT_PARTS_FORMAT + 1}, newer than this version of kiri reads`,
      ),
    );
  });

  it.each([
    ["a value that is not a list", { type: "text" }],
    ["a part without a type", [{ text: "untyped" }]],
    ["a part that is not an object", ["text"]],
  ])("rejects %s", (_name, raw) => {
    expect(() => readStoredParts("m1", CURRENT_PARTS_FORMAT, raw)).toThrow(TranscriptFormatError);
  });

  it.each([
    ["data-inbox", [{ ...inbox, data: { ...inbox.data, source: "stranger" } }]],
    ["data-checkpoint", [{ type: "data-checkpoint", id: "c", data: {} }]],
    [
      "data-checkpoint",
      [{ type: "data-checkpoint", id: "c", data: { summary: "s", pendingMessages: [{}] } }],
    ],
    ["data-instructions", [{ type: "data-instructions", data: { workspace: "w" } }]],
    ["data-context-calibration", [{ type: "data-context-calibration", data: "v2" }]],
  ])("rejects a malformed %s part", (type, raw) => {
    expect(() => readStoredParts("m1", LEGACY_PARTS_FORMAT, raw)).toThrow(
      new TranscriptFormatError("m1", `its "${type}" part is malformed`),
    );
  });
});
