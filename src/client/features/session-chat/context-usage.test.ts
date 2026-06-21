import { describe, expect, it } from "bun:test";
import type { ModelInfo, SessionMessage } from "../../api.ts";
import { contextWindowForModel, currentContextTokens } from "./context-usage.ts";

const message = (usage: SessionMessage["usage"]): SessionMessage => ({
  id: "m",
  sessionId: "s1",
  index: 0,
  role: "assistant",
  parts: [{ type: "text", text: "hi" }],
  usage,
  createdAt: "2026-05-09T12:00:00.000Z",
});

describe("currentContextTokens", () => {
  it("is undefined when no turn has settled with usage", () => {
    expect(currentContextTokens([])).toBeUndefined();
    expect(currentContextTokens([message(null)])).toBeUndefined();
  });

  it("is undefined when the last usage reports no input tokens", () => {
    expect(currentContextTokens([message({ outputTokens: 5 })])).toBeUndefined();
  });

  it("sums the last settled turn's input and output tokens", () => {
    expect(currentContextTokens([message({ inputTokens: 100, outputTokens: 50 })])).toBe(150);
    expect(currentContextTokens([message({ inputTokens: 100 })])).toBe(100);
  });

  it("reads the most recent message carrying usage", () => {
    expect(
      currentContextTokens([
        message({ inputTokens: 10, outputTokens: 1 }),
        message(null),
        message({ inputTokens: 200, outputTokens: 40 }),
      ]),
    ).toBe(240);
  });
});

describe("contextWindowForModel", () => {
  const models: ModelInfo[] = [
    { id: "anthropic:claude", provider: "anthropic", contextWindow: 200000 },
    { id: "local:custom", provider: "local" },
  ];

  it("returns the matching model's context window", () => {
    expect(contextWindowForModel(models, "anthropic:claude")).toBe(200000);
  });

  it("is undefined when the model is uncatalogued or absent", () => {
    expect(contextWindowForModel(models, "local:custom")).toBeUndefined();
    expect(contextWindowForModel(models, "openai:gpt")).toBeUndefined();
  });
});
