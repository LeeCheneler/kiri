import { describe, expect, it } from "bun:test";
import { type ModelMessage, type UIMessage, convertToModelMessages } from "ai";
import {
  contextSnapshot,
  measuredContextTokens,
  savedContextCalibration,
  withContextCalibration,
  withoutContextCalibration,
} from "./context-calibration.ts";

const request = {
  model: "test:model",
  contextWindow: 272000,
  system: "Standing instructions",
  tools: [{ name: "read", inputSchema: { type: "object" } }],
  messages: [{ role: "user", content: "Earlier context ".repeat(10000) }] satisfies ModelMessage[],
};

describe("context calibration", () => {
  it("reuses measured input and charges new content at its full estimate", () => {
    const previous = { ...contextSnapshot(request), inputTokens: 20000 };
    expect(measuredContextTokens(contextSnapshot(request), previous)).toBe(22000);
    const next = contextSnapshot({
      ...request,
      messages: [...request.messages, { role: "user", content: "New evidence ".repeat(5000) }],
    });
    expect(measuredContextTokens(next, previous)).toBeGreaterThan(22000 + 20000);
    expect(measuredContextTokens(next, previous)).toBeLessThan(next.estimate);
  });

  it.each(["system", "tools", "messages"] as const)(
    "charges a same-size %s replacement instead of discounting it",
    (field) => {
      const original = {
        ...request,
        system: "x".repeat(30000),
        tools: [{ description: "x".repeat(30000) }],
        messages: [{ role: "user", content: "x".repeat(30000) }] satisfies ModelMessage[],
      };
      const previous = { ...contextSnapshot(original), inputTokens: 1000 };
      const replacement = JSON.parse(JSON.stringify(original[field]).replaceAll("xxxx", "yyyy"));
      const next = contextSnapshot({ ...original, [field]: replacement });
      expect(next.estimate).toBe(previous.estimate);
      expect(measuredContextTokens(next, previous)).toBeGreaterThan(11000);
    },
  );

  it("charges repeated copies only after consuming matching occurrences", () => {
    const previous = { ...contextSnapshot(request), inputTokens: 20000 };
    const doubled = contextSnapshot({
      ...request,
      messages: [...request.messages, ...request.messages],
    });
    expect(measuredContextTokens(doubled, previous)).toBeGreaterThan(22000 + 50000);
  });

  it("does not subtract an unknown token cost when content is removed", () => {
    const previous = { ...contextSnapshot(request), inputTokens: 20000 };
    expect(measuredContextTokens(contextSnapshot({ ...request, tools: [] }), previous)).toBe(22000);
  });

  it("retains the higher measured ratio for new material when bytes underestimate input", () => {
    const snapshot = contextSnapshot(request);
    const previous = { ...snapshot, inputTokens: snapshot.estimate * 2 };
    const next = contextSnapshot({
      ...request,
      messages: [...request.messages, { role: "user", content: "y".repeat(30000) }],
    });
    expect(measuredContextTokens(next, previous)).toBeGreaterThan(
      previous.inputTokens * 1.1 + 22000,
    );
  });

  it("falls back for changed models, options, windows, and missing or invalid measurements", () => {
    const previous = { ...contextSnapshot(request), inputTokens: 20000 };
    for (const change of [
      { model: "test:other" },
      { providerOptions: { effort: "high" } },
      { contextWindow: 32000 },
    ]) {
      const next = contextSnapshot({ ...request, ...change });
      expect(measuredContextTokens(next, previous)).toBe(next.estimate);
    }
    const next = contextSnapshot(request);
    expect(measuredContextTokens(next, undefined)).toBe(next.estimate);
    for (const inputTokens of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(measuredContextTokens(next, { ...previous, inputTokens })).toBe(next.estimate);
    }
  });

  it("matches SDK property reordering and detects changed image bytes", () => {
    const previous = { ...contextSnapshot(request), inputTokens: 20000 };
    const reordered = contextSnapshot({
      ...request,
      tools: [{ inputSchema: { type: "object" }, name: "read" }],
    });
    expect(measuredContextTokens(reordered, previous)).toBe(22000);
    const image = (byte: number): ModelMessage => ({
      role: "user",
      content: [{ type: "image", image: new Uint8Array([byte]).buffer }],
    });
    expect(contextSnapshot({ ...request, messages: [image(1)] }).components).not.toEqual(
      contextSnapshot({ ...request, messages: [image(2)] }).components,
    );
  });

  it("persists counts without prompt contents and excludes bookkeeping from model history", async () => {
    const message: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Completed once" }],
    };
    const calibration = { ...contextSnapshot(request), inputTokens: 20000 };
    const saved = JSON.parse(JSON.stringify(withContextCalibration(message, calibration)));
    expect(savedContextCalibration([saved])).toEqual(calibration);
    expect(JSON.stringify(saved)).not.toContain("Earlier context");
    expect(await convertToModelMessages(withoutContextCalibration([saved]))).toEqual(
      await convertToModelMessages([message]),
    );
    expect(withContextCalibration(saved, undefined)).toEqual(message);
    expect(message.parts).toHaveLength(1);
  });

  it("ignores user lookalikes and stops restoring measurements at a newer checkpoint", () => {
    const calibration = { ...contextSnapshot(request), inputTokens: 20000 };
    const saved = withContextCalibration({ id: "m1", role: "assistant", parts: [] }, calibration);
    expect(savedContextCalibration([{ ...saved, role: "user" }])).toBeUndefined();
    expect(
      savedContextCalibration([
        saved,
        {
          id: "m2",
          role: "assistant",
          parts: [{ type: "data-checkpoint", id: "cp1", data: { summary: "New context" } }],
        },
      ]),
    ).toBeUndefined();
  });
});
