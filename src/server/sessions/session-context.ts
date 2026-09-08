import { type JSONValue, type ModelMessage, type UIMessage, getToolName, isToolUIPart } from "ai";

// Only known evidence reads may be shortened. Skill instructions, task lists,
// action outcomes, recovery pages, and unknown tools retain their full content.
const EVIDENCE_TOOLS = new Set([
  "read_file",
  "search_files",
  "find_files",
  "list_directory",
  "read_article",
  "list_articles",
  "read_memory",
  "read_workflow",
  "list_workflows",
]);

const MIN_COMPACT_LENGTH = 8000;
const EXCERPT_LENGTH = 2000;

/** Estimate serialized request tokens conservatively; this is not a provider tokenizer. */
export function estimateContextTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value) ?? "") / 3) + 256;
}

/** Reserve output/reasoning and tool-result space, using a 32K working window when unknown. */
export function contextBudget(contextWindow: number | undefined, reasoningTokens = 0) {
  const window =
    contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0
      ? Math.floor(contextWindow)
      : 32768;
  const outputTokens = Math.max(
    Math.min(8192, Math.max(1024, Math.floor(window * 0.2))),
    reasoningTokens + 1024,
  );
  const handoffInputTokens = Math.max(0, window - outputTokens);
  return {
    outputTokens,
    handoffInputTokens,
    workInputTokens: Math.max(0, handoffInputTokens - Math.min(4096, Math.floor(window * 0.1))),
  };
}

/**
 * Apply recoverable excerpts to model messages without changing their ordering or call/result pairs.
 * Only uniquely identified, checkpointed results from this session can be replaced.
 */
export function compactModelMessages(
  messages: ModelMessage[],
  savedHistory: UIMessage[],
  options: { tokensToSave: number; recoveryAvailable: boolean },
): ModelMessage[] {
  const compacted = compactSessionHistory(savedHistory, options);
  if (compacted === savedHistory) return messages;
  const replacements = new Map<string, { toolName: string; output: JSONValue }>();
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (let i = 0; i < savedHistory.length; i++) {
    for (let j = 0; j < savedHistory[i].parts.length; j++) {
      const original = savedHistory[i].parts[j];
      if (!isToolUIPart(original)) continue;
      if (seen.has(original.toolCallId)) duplicates.add(original.toolCallId);
      seen.add(original.toolCallId);
      const part = compacted[i].parts[j];
      if (part !== original && isToolUIPart(part) && part.state === "output-available") {
        replacements.set(part.toolCallId, {
          toolName: getToolName(part),
          output: part.output as JSONValue,
        });
      }
    }
  }
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result" || duplicates.has(part.toolCallId)) return part;
        const replacement = replacements.get(part.toolCallId);
        if (
          !replacement ||
          replacement.toolName !== part.toolName ||
          (part.output.type !== "json" && part.output.type !== "text")
        )
          return part;
        return { ...part, output: { type: "json" as const, value: replacement.output } };
      }),
    };
  });
}

/**
 * Shorten large saved evidence results until the estimated savings meet the request.
 * Retains calls, text, instructions, and action outcomes; never mutates stored history.
 * Recovery must be available, and every message must come from this session's saved transcript.
 */
export function compactSessionHistory(
  history: UIMessage[],
  options: { tokensToSave: number; recoveryAvailable: boolean },
): UIMessage[] {
  if (!options.recoveryAvailable || !(options.tokensToSave > 0)) return history;
  // A rough byte-based estimate, not a provider tokenizer. Budget enforcement
  // must still account for protected content that cannot be compacted away.
  let bytesToSave = options.tokensToSave * 3;
  let changed = false;
  const compacted = history.map((message) => {
    if (message.role !== "assistant") return message;
    let messageChanged = false;
    const parts = message.parts.map((part) => {
      if (
        bytesToSave <= 0 ||
        !isToolUIPart(part) ||
        part.state !== "output-available" ||
        !EVIDENCE_TOOLS.has(getToolName(part))
      )
        return part;
      const text = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
      if (text === undefined || text.length <= MIN_COMPACT_LENGTH) return part;
      const output = {
        context_compacted: true,
        notice:
          "Partial historical evidence, not the full result. Reopen the saved result for missing details; do not replay an action to recover its output.",
        read_tool_result: { message_id: message.id, tool_call_id: part.toolCallId },
        original_length: text.length,
        format: typeof part.output === "string" ? "text" : "json",
        excerpt: text.slice(0, EXCERPT_LENGTH),
      };
      const saved =
        Buffer.byteLength(JSON.stringify(part.output)) - Buffer.byteLength(JSON.stringify(output));
      if (saved <= 0) return part;
      bytesToSave -= saved;
      changed = true;
      messageChanged = true;
      return { ...part, output };
    });
    return messageChanged ? { ...message, parts } : message;
  });
  return changed ? compacted : history;
}
