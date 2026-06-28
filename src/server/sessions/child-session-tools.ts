import { type Tool, type UIMessage, getToolName, isToolUIPart } from "ai";
import type { KiriDb } from "../db/index.ts";
import {
  INVESTIGATE_CHILD_GUIDANCE,
  INVESTIGATE_TOOL_NAME,
  investigateTool,
} from "./investigate-tool.ts";
import { type Session, getSessionMessages } from "./store.ts";

/** A first-party tool whose calls run as an embedded child session. */
export interface ChildSessionTool {
  tool: Tool;
  /**
   * Prompt overlay appended to the generic child-session prompt for a child this
   * tool spawned — the tool's worker-side flavour.
   */
  guidance: string;
}

/**
 * The first-party tools that run as embedded child sessions, keyed by the name
 * they're offered to the model under. The single place these tools are listed:
 * the session route offers them (to top-level sessions only) and resolves a
 * child's prompt overlay from here, so adding one is a single entry.
 */
export const childSessionTools = new Map<string, ChildSessionTool>([
  [INVESTIGATE_TOOL_NAME, { tool: investigateTool, guidance: INVESTIGATE_CHILD_GUIDANCE }],
]);

/**
 * The prompt overlay for a child session, resolved from the tool that spawned it:
 * find the parent's tool call (`parent_tool_call_id`) and return that tool's
 * registered guidance. `undefined` for a top-level session, or a child whose
 * spawning call isn't a registered child-session tool — the worker then runs on
 * the generic core alone.
 */
export function childSessionGuidance(db: KiriDb, session: Session): string | undefined {
  if (session.parentSessionId === null || session.parentToolCallId === null) return undefined;
  for (const message of getSessionMessages(db, session.parentSessionId)) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts as UIMessage["parts"]) {
      if (isToolUIPart(part) && part.toolCallId === session.parentToolCallId) {
        return childSessionTools.get(getToolName(part))?.guidance;
      }
    }
  }
  return undefined;
}
