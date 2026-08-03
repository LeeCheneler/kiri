import type { JSONValue } from "ai";
import type { LlmProvider } from "./schema.ts";

/** The effort levels a session (or delegated worker) can run at, lowest first. */
export const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

/** How hard a model reasons: one of {@link EFFORT_LEVELS}. */
export type Effort = (typeof EFFORT_LEVELS)[number];

/** Provider options for one model call, keyed by the provider-options name the AI SDK reads. */
export type EffortProviderOptions = Record<string, Record<string, JSONValue>>;

// Anthropic expresses effort as an extended-thinking token budget. The ladder
// roughly doubles per level; the AI SDK caps the accompanying max_tokens at
// the model's own output limit, so even `max` is always sendable.
const ANTHROPIC_THINKING_BUDGETS: Record<Effort, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 32768,
};

// OpenAI's Chat Completions `reasoning_effort` tops out at "high" across the
// model range (higher values exist only for specific models), so `max` maps
// to "high" rather than risking a value the model rejects.
const OPENAI_REASONING_EFFORT: Record<Effort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  max: "high",
};

/**
 * Map an effort level to the provider options one model call needs to run at
 * it: an Anthropic extended-thinking budget, or an OpenAI-style
 * `reasoning_effort` — sent under the provider's own options key for an
 * `openai-compatible` endpoint, which passes it through in the same shape.
 * Callers gate on the model's reasoning capability; this maps unconditionally.
 */
export function effortProviderOptions(
  provider: LlmProvider,
  effort: Effort,
): EffortProviderOptions {
  switch (provider.type) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: ANTHROPIC_THINKING_BUDGETS[effort] },
        },
      };
    case "openai":
      return { openai: { reasoningEffort: OPENAI_REASONING_EFFORT[effort] } };
    case "openai-compatible":
      // The AI SDK reads an openai-compatible model's options under the name
      // the provider was created with — kiri's configured provider name.
      return { [provider.name]: { reasoningEffort: OPENAI_REASONING_EFFORT[effort] } };
  }
}
