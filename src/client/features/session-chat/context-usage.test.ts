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
  it("is undefined until a turn has settled with a recorded footprint", () => {
    expect(currentContextTokens([])).toBeUndefined();
    expect(currentContextTokens([message(null)])).toBeUndefined();
    // Usage without a footprint (e.g. an older message) shows nothing.
    expect(currentContextTokens([message({ inputTokens: 100, outputTokens: 50 })])).toBeUndefined();
  });

  it("reads the most recent message's context footprint", () => {
    expect(
      currentContextTokens([
        message({ contextTokens: 11 }),
        message(null),
        message({ contextTokens: 240 }),
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
