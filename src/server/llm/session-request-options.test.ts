import { expect, it } from "bun:test";
import { type ModelDescription, buildModelDescription } from "./model-description.ts";
import type { LlmProvider } from "./schema.ts";
import { sessionRequestOptions } from "./session-request-options.ts";

const description = (provider: LlmProvider, modelId = "test-model"): ModelDescription =>
  buildModelDescription(provider, modelId, undefined);

it.each(["openai", "openai-codex"] as const)(
  "merges %s affinity without losing reasoning or other provider options",
  (type) => {
    const existing = { openai: { reasoningEffort: "high" }, other: { enabled: true } };
    const result = sessionRequestOptions(description({ name: "work", type }), "session", existing);

    expect(result.providerOptions).toEqual({
      openai: { reasoningEffort: "high", promptCacheKey: "session" },
      other: { enabled: true },
    });
    expect(result.headers).toEqual(
      type === "openai-codex" ? { "session-id": "session" } : undefined,
    );
    expect(existing).toEqual({ openai: { reasoningEffort: "high" }, other: { enabled: true } });
  },
);

it("enables Anthropic automatic caching independently of reasoning support", () => {
  const model = description({ name: "claude", type: "anthropic" });
  expect(sessionRequestOptions(model, "session")).toEqual({
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  });
  expect(sessionRequestOptions(model, "session", { anthropic: { effort: "low" } })).toEqual({
    providerOptions: { anthropic: { effort: "low", cacheControl: { type: "ephemeral" } } },
  });
});

it.each(["anthropic/claude-sonnet-4.5", "openai/gpt-5.2", "openrouter/auto"])(
  "sets OpenRouter session routing with model-appropriate caching for %s",
  (modelId) => {
    const model = description(
      { name: "gateway", type: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1" },
      modelId,
    );
    expect(
      sessionRequestOptions(model, "session", { gateway: { reasoningEffort: "medium" } }),
    ).toEqual({
      providerOptions: {
        gateway: {
          reasoningEffort: "medium",
          session_id: "session",
          ...(modelId.startsWith("anthropic/") ? { cache_control: { type: "ephemeral" } } : {}),
        },
      },
    });
    expect(sessionRequestOptions(model, "session").providerOptions?.gateway?.session_id).toBe(
      "session",
    );
  },
);

it("leaves unknown compatible endpoints unchanged", () => {
  const model = description({
    name: "local",
    type: "openai-compatible",
    baseUrl: "http://localhost/v1",
  });
  expect(sessionRequestOptions(model, "session")).toEqual({});
  const existing = { local: { reasoningEffort: "high" } };
  expect(sessionRequestOptions(model, "session", existing)).toEqual({ providerOptions: existing });
});
