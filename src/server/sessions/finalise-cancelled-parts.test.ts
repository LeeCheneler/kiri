import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { CANCELLED_ERROR_TEXT } from "../../shared/cancelled-tool-call.ts";
import { finaliseCancelledParts } from "./finalise-cancelled-parts.ts";

type Parts = UIMessage["parts"];
const p = (part: unknown) => part as Parts[number];

const step = p({ type: "step-start" });
const text = (t: string) => p({ type: "text", text: t, state: "done" });
const reasoning = (t: string) => p({ type: "reasoning", text: t, state: "streaming" });
const call = (id: string, state: string, extra: Record<string, unknown> = {}) =>
  p({ type: "tool-echo", toolCallId: id, state, input: { value: id }, ...extra });

describe("finaliseCancelledParts", () => {
  it("keeps text and finished tool calls untouched", () => {
    const parts = [
      step,
      text("Looking."),
      call("c1", "output-available", { output: { ok: true } }),
      call("c2", "output-error", { errorText: "boom" }),
      call("c3", "output-denied"),
    ];
    expect(finaliseCancelledParts(parts)).toEqual(parts);
  });

  it("closes an executing call out as cancelled, so it carries a result", () => {
    for (const state of ["input-available", "approval-responded"]) {
      const out = finaliseCancelledParts([step, call("c1", state)]);
      expect(out).toEqual([step, call("c1", "output-error", { errorText: CANCELLED_ERROR_TEXT })]);
    }
  });

  it("drops a call still streaming its input", () => {
    expect(finaliseCancelledParts([step, text("Now I'll"), call("c1", "input-streaming")])).toEqual(
      [step, text("Now I'll")],
    );
  });

  it("drops trailing reasoning the cancel interrupted, and its step marker", () => {
    expect(
      finaliseCancelledParts([step, text("Done one."), step, reasoning("thinking ab")]),
    ).toEqual([step, text("Done one.")]);
  });

  it("keeps reasoning that something followed", () => {
    const parts = [step, reasoning("plan"), text("Answer.")];
    expect(finaliseCancelledParts(parts)).toEqual(parts);
  });

  it("returns null when nothing substantive survives", () => {
    expect(finaliseCancelledParts([])).toBeNull();
    expect(finaliseCancelledParts([step])).toBeNull();
    expect(finaliseCancelledParts([step, reasoning("hm")])).toBeNull();
    expect(finaliseCancelledParts([step, call("c1", "input-streaming")])).toBeNull();
    expect(
      finaliseCancelledParts([step, p({ type: "text", text: "", state: "streaming" })]),
    ).toBeNull();
  });
});
