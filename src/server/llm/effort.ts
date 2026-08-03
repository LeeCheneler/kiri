import type { JSONValue } from "ai";
import type { LlmProvider } from "./schema.ts";

/** The effort levels a session (or delegated worker) can run at, lowest first. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** How hard a model reasons: one of {@link EFFORT_LEVELS}. */
export type Effort = (typeof EFFORT_LEVELS)[number];

/** Provider options for one model call, keyed by the provider-options name the AI SDK reads. */
export type EffortProviderOptions = Record<string, Record<string, JSONValue>>;

// OpenAI-style `reasoning_effort` — Chat Completions, and the same setting
// on openai-compatible endpoints, applied by the host when the model
// supports it — tops out at "xhigh" with no "max", so kiri's max sends the
// top. Levels below it pass through as requested: a model that doesn't take
// a given level rejects it like any other provider error rather than being
// silently clamped.
const OPENAI_REASONING_EFFORT: Record<Effort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "xhigh",
};

// What a Claude model's effort parameter accepts, by generation: the full
// low..max ladder, the ladder without xhigh, the original three-level
// low/medium/high, or no effort parameter at all.
type ClaudeEffortSupport = "full" | "no-xhigh" | "three-level" | "none";

// Family and version of a Claude id ("claude-opus-4-8",
// "anthropic/claude-sonnet-4.5" — dotted or dashed, with or without a path
// prefix). The minor is capped at two digits so a date suffix never reads as
// one: "claude-opus-4-20250514" is the 4.0 generation, not minor 20250514.
// No match for an id outside this shape (a new family, a bare alias), which
// classifies as modern below.
const CLAUDE_VERSION = /(^|[-_/.])claude-(opus|sonnet|haiku)-(\d+)(?:[-.](\d{1,2}))?(?=[-_/.]|$)/i;

// The older version-first naming ("claude-3-7-sonnet", "claude-2.1",
// "claude-instant-1.2") — all generations that predate the effort parameter.
const CLAUDE_LEGACY = /(^|[-_/.])claude-(instant|[123])(?=[-_/.]|$)/i;

// Which effort ladder a Claude generation takes. The effort parameter
// arrived with opus-4-5 (low/medium/high), the 4.6 generation added max, and
// everything from opus-4-7 on takes the full ladder including xhigh. Older
// thinking models (claude-3-7, sonnet-4.5, haiku-4.5, the 4/4.1 originals)
// predate the parameter and get nothing — their thinking-budget config is
// removed on the generations that replaced them, so nothing else is sendable
// either. An unrecognised id shape is treated as modern: full ladder.
function claudeEffortSupport(modelId: string): ClaudeEffortSupport {
  if (CLAUDE_LEGACY.test(modelId)) return "none";
  const match = CLAUDE_VERSION.exec(modelId);
  if (!match) return "full";
  const family = (match[2] as string).toLowerCase();
  const major = Number(match[3]);
  const minor = Number(match[4] ?? 0);
  if (major >= 5) return "full";
  if (major <= 3) return "none";
  if (minor >= 7) return "full";
  if (minor === 6) return "no-xhigh";
  return minor === 5 && family === "opus" ? "three-level" : "none";
}

// Clamp an effort level to what the Claude generation accepts, or undefined
// for a model with no effort parameter — the caller then sends nothing.
function clampClaudeEffort(modelId: string, effort: Effort): Effort | undefined {
  switch (claudeEffortSupport(modelId)) {
    case "full":
      return effort;
    case "no-xhigh":
      return effort === "xhigh" ? "high" : effort;
    case "three-level":
      return effort === "xhigh" || effort === "max" ? "high" : effort;
    case "none":
      return undefined;
  }
}

/**
 * Map an effort level to the provider options one model call needs to run at
 * it: Anthropic's effort parameter (`output_config.effort` on the wire,
 * clamped to what the Claude generation accepts, thinking left unset so
 * modern models keep their adaptive default), or an OpenAI-style
 * `reasoning_effort` — sent under the provider's own options key for an
 * `openai-compatible` endpoint, which passes it through in the same shape.
 * Undefined when the model takes no effort parameter at all. Callers gate on
 * the model's reasoning capability; this maps within that gate.
 */
export function effortProviderOptions(
  provider: LlmProvider,
  modelId: string,
  effort: Effort,
): EffortProviderOptions | undefined {
  switch (provider.type) {
    case "anthropic": {
      const clamped = clampClaudeEffort(modelId, effort);
      return clamped === undefined ? undefined : { anthropic: { effort: clamped } };
    }
    case "openai":
      return { openai: { reasoningEffort: OPENAI_REASONING_EFFORT[effort] } };
    case "openai-compatible":
      // The AI SDK reads an openai-compatible model's options under the name
      // the provider was created with — kiri's configured provider name.
      return { [provider.name]: { reasoningEffort: OPENAI_REASONING_EFFORT[effort] } };
  }
}
