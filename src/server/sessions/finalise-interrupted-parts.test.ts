import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { CANCELLED_ERROR_TEXT } from "../../shared/cancelled-tool-call.ts";
import { finaliseInterruptedParts } from "./finalise-interrupted-parts.ts";

type Parts = UIMessage["parts"];
const p = (part: unknown) => part as Parts[number];

const step = p({ type: "step-start" });
const text = (t: string) => p({ type: "text", text: t, state: "done" });
const reasoning = (t: string) => p({ type: "reasoning", text: t, state: "streaming" });
const call = (id: string, state: string, extra: Record<string, unknown> = {}) =>
  p({ type: "tool-echo", toolCallId: id, state, input: { value: id }, ...extra });

describe("finaliseInterruptedParts", () => {
  it("keeps text and finished tool calls untouched", () => {
    const parts = [
      step,
      text("Looking."),
      call("c1", "output-available", { output: { ok: true } }),
      call("c2", "output-error", { errorText: "boom" }),
      call("c3", "output-denied"),
    ];
    expect(finaliseInterruptedParts(parts)).toEqual(parts);
  });

  it("closes an executing call out as cancelled, so it carries a result", () => {
    for (const state of ["input-available", "approval-responded"]) {
      const out = finaliseInterruptedParts([step, call("c1", state)]);
      expect(out).toEqual([step, call("c1", "output-error", { errorText: CANCELLED_ERROR_TEXT })]);
    }
  });

  it("drops a call still streaming its input", () => {
    expect(
      finaliseInterruptedParts([step, text("Now I'll"), call("c1", "input-streaming")]),
    ).toEqual([step, text("Now I'll")]);
  });

  it("drops trailing reasoning the cancel interrupted, and its step marker", () => {
    expect(
      finaliseInterruptedParts([step, text("Done one."), step, reasoning("thinking ab")]),
    ).toEqual([step, text("Done one.")]);
  });

  it("keeps reasoning that something followed", () => {
    const parts = [step, reasoning("plan"), text("Answer.")];
    expect(finaliseInterruptedParts(parts)).toEqual(parts);
  });

  it("returns null when nothing substantive survives", () => {
    expect(finaliseInterruptedParts([])).toBeNull();
    expect(finaliseInterruptedParts([step])).toBeNull();
    expect(finaliseInterruptedParts([step, reasoning("hm")])).toBeNull();
    expect(finaliseInterruptedParts([step, call("c1", "input-streaming")])).toBeNull();
    expect(
      finaliseInterruptedParts([step, p({ type: "text", text: "", state: "streaming" })]),
    ).toBeNull();
  });

  it("records an unknown result on failure without changing completed calls or pending approvals", () => {
    const errorText = "The result is unknown. Verify the action before retrying.";
    const finished = call("done", "output-available", { output: "saved" });
    const approval = call("pending", "approval-requested", { approval: { id: "a1" } });
    expect(
      finaliseInterruptedParts([finished, call("running", "input-available"), approval], errorText),
    ).toEqual([finished, call("running", "output-error", { errorText }), approval]);
  });
});
