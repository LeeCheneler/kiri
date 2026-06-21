import type { ModelInfo, SessionMessage } from "../../api.ts";

/**
 * Warn once a session's context fill reaches this fraction of the model's
 * window — close enough that the next turn or two risks a hard provider failure.
 */
export const CONTEXT_WARNING_RATIO = 0.9;

/**
 * The live context fill, approximated by the most recent settled turn's
 * footprint: the tokens it sent (all prior messages) plus the reply it produced,
 * now part of history. The session's cumulative totals count every turn's
 * resend, so they overstate it. `undefined` until a turn has settled with
 * reported usage — there's nothing meaningful to show before then.
 */
export function currentContextTokens(messages: SessionMessage[]): number | undefined {
  const usage = messages.findLast((message) => message.usage)?.usage;
  if (!usage || usage.inputTokens === undefined) return undefined;
  return usage.inputTokens + (usage.outputTokens ?? 0);
}

/** The context window of `modelId` from the listed models, or undefined when uncatalogued. */
export function contextWindowForModel(models: ModelInfo[], modelId: string): number | undefined {
  return models.find((model) => model.id === modelId)?.contextWindow;
}
