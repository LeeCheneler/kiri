import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
import type { ModelDescription } from "./model-description.ts";

/** Provider-specific request controls for a conversation, preserving existing generation options. */
export function sessionRequestOptions(
  description: ModelDescription,
  sessionId: string,
  providerOptions?: SharedV3ProviderOptions,
): { providerOptions?: SharedV3ProviderOptions; headers?: Record<string, string> } {
  switch (description.transport.endpoint) {
    case "openai-codex":
    case "openai":
      return {
        providerOptions: {
          ...providerOptions,
          openai: { ...providerOptions?.openai, promptCacheKey: sessionId },
        },
        // The subscription backend derives cache affinity from this header,
        // independently of the public API's prompt cache key.
        ...(description.transport.endpoint === "openai-codex"
          ? { headers: { "session-id": sessionId } }
          : {}),
      };
    case "anthropic":
      return {
        providerOptions: {
          ...providerOptions,
          anthropic: {
            ...providerOptions?.anthropic,
            cacheControl: { type: "ephemeral" },
          },
        },
      };
    case "openrouter":
      return {
        providerOptions: {
          ...providerOptions,
          [description.provider]: {
            ...providerOptions?.[description.provider],
            session_id: sessionId,
            ...(description.modelId.startsWith("anthropic/claude-")
              ? { cache_control: { type: "ephemeral" } }
              : {}),
          },
        },
      };
    case "custom":
      return providerOptions === undefined ? {} : { providerOptions };
  }
}
