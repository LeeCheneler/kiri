import { type UIMessage, getToolName, isToolUIPart } from "ai";
import type { Message } from "./store.ts";

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

/** Read the most recent recorded model-call footprint, if one is available. */
export function currentContextTokens(rows: Message[]): number | undefined {
  return rows.findLast((row) => row.contextTokens != null)?.contextTokens ?? undefined;
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
