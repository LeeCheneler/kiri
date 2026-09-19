import type { EffortProviderOptions } from "../llm/index.ts";
import { contextBudget } from "./session-context.ts";

/** The token allowances one turn's context decisions are made against. */
export interface ContextLimits {
  /** Input a work request may use, leaving room for output and tool results. */
  workInputTokens: number;
  /** Input the tool-free handoff may use, with the tool-result room reclaimed. */
  handoffInputTokens: number;
  /** Work-request size at which earlier history is summarised. */
  compactionThreshold: number;
  /** Length a summary is asked to stay within. */
  summaryBudget: number;
}

// An explicit thinking budget is output the provider will spend before the
// reply, so it is reserved in full rather than silently reduced.
function reservedReasoningTokens(providerOptions: EffortProviderOptions | undefined): number {
  const thinking = providerOptions?.anthropic?.thinking;
  return thinking &&
    typeof thinking === "object" &&
    !Array.isArray(thinking) &&
    typeof thinking.budgetTokens === "number"
    ? thinking.budgetTokens
    : 0;
}

/**
 * Derive a turn's limits from the model's context window and the provider
 * options its calls are sent with. Compaction starts at 85% of the work
 * allowance; a summary is asked for at most 20% of it, capped at 4,096 tokens.
 */
export function contextLimits(
  contextWindow: number | undefined,
  providerOptions?: EffortProviderOptions,
): ContextLimits {
  const { workInputTokens, handoffInputTokens } = contextBudget(
    contextWindow,
    reservedReasoningTokens(providerOptions),
  );
  return {
    workInputTokens,
    handoffInputTokens,
    compactionThreshold: Math.floor(workInputTokens * 0.85),
    summaryBudget: Math.min(4096, Math.floor(workInputTokens * 0.2)),
  };
}

/** What a step boundary knows when it decides how to go on. */
export interface StepContext {
  limits: ContextLimits;
  /** Size of the whole work request, measured against the last call where possible. */
  requestTokens: number;
  /** Heuristic size of what no summary can shrink: the system prompt and tool schemas. */
  fixedTokens: number;
  /** An unanswered approval must stay a real tool part for its later resume. */
  pendingApprovals: boolean;
  stepNumber: number;
  /** Messages that opened this turn; zero for a continuation. */
  incomingMessageCount: number;
  /** Model messages that precede the incoming ones. */
  previousMessageCount: number;
  /** Model messages in the request. */
  messageCount: number;
  /** A summary was already accepted at this boundary. */
  compacted: boolean;
}

/**
 * How a step goes on: with the request as it stands, after summarising its
 * first `summarise` messages, or not at all. `carryIncoming` marks a summary
 * taken before any work, which leaves the incoming messages out and saves
 * them alongside it.
 */
export type StepDecision =
  | { action: "continue" }
  | { action: "compact"; summarise: number; carryIncoming: boolean }
  | { action: "stop" };

/**
 * Decide how a step boundary goes on. History is summarised once the request
 * reaches the compaction threshold — unless an approval is pending, there is
 * nothing to summarise, or the fixed context alone reaches the threshold, in
 * which case no summary could bring the request under it. A boundary
 * compacts at most once. Otherwise the step runs while the request fits the
 * work allowance.
 */
export function decideStep(context: StepContext): StepDecision {
  const { limits, requestTokens } = context;
  // Before any work, only the history preceding the incoming messages is
  // summarised. Later boundaries summarise completed tool steps as well.
  const carryIncoming = context.stepNumber === 0 && context.incomingMessageCount > 0;
  const summarise = carryIncoming
    ? Math.min(context.previousMessageCount, context.messageCount)
    : context.messageCount;
  if (
    !context.compacted &&
    !context.pendingApprovals &&
    summarise > 0 &&
    context.fixedTokens < limits.compactionThreshold &&
    requestTokens >= limits.compactionThreshold
  )
    return { action: "compact", summarise, carryIncoming };
  return { action: requestTokens <= limits.workInputTokens ? "continue" : "stop" };
}

/**
 * Decide whether a summary may replace the history it covers. It must exist,
 * shrink the heuristic estimate of the request, and leave that estimate below
 * the compaction threshold; otherwise the turn stops rather than compact again
 * at every boundary.
 */
export function decideSummary(summary: {
  limits: ContextLimits;
  produced: boolean;
  /** Heuristic size of the request rebuilt on the summary. */
  summaryEstimate: number;
  /** Heuristic size of the request the summary replaces. */
  previousEstimate: number;
}): "resume" | "stop" {
  return summary.produced &&
    summary.summaryEstimate < summary.limits.compactionThreshold &&
    summary.summaryEstimate < summary.previousEstimate
    ? "resume"
    : "stop";
}

/** Decide whether a stopped turn may spend its one tool-free handoff call. */
export function decideHandoff(handoff: {
  limits: ContextLimits;
  handoffTokens: number;
}): "handoff" | "stop" {
  return handoff.handoffTokens <= handoff.limits.handoffInputTokens ? "handoff" : "stop";
}
