import type { ModelInfo, SessionMessage } from "../../api.ts";

/**
 * Warn once a session's context fill reaches this fraction of the model's
 * window — close enough that the next turn or two risks a hard provider failure.
 */
export const CONTEXT_WARNING_RATIO = 0.9;

/**
 * The live context fill: the most recent settled turn's recorded context
 * footprint — its last model call's total tokens. `undefined` until a turn has
 * settled with a footprint (a brief gap a fresh turn fills); not back-filled
 * from summed input+output, which over-states a multi-step tool turn.
 */
export function currentContextTokens(messages: SessionMessage[]): number | undefined {
  return messages.findLast((message) => message.usage)?.usage?.contextTokens;
}

/** The context window of `modelId` from the listed models, or undefined when uncatalogued. */
export function contextWindowForModel(models: ModelInfo[], modelId: string): number | undefined {
  return models.find((model) => model.id === modelId)?.contextWindow;
}
