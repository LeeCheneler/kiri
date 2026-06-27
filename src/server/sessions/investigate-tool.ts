import { type Tool, tool } from "ai";
import { z } from "zod";

/** Namespaced name the investigate tool is offered to the model under. */
export const INVESTIGATE_TOOL_NAME = "investigate";

/**
 * The first-party `investigate` tool: a client-completed tool with no server
 * `execute`. When the model calls it the turn pauses with the call awaiting an
 * output; the client runs the investigation as a child session and supplies its
 * report as the tool output, which resumes the turn. Its description is written
 * for the calling model — when to delegate and how to brief the investigator.
 */
export const investigateTool: Tool = tool({
  description: [
    "Delegate a self-contained research task to a separate investigator assistant that runs its own tool calls (such as web search) and reports back only a concise, sourced summary.",
    "Reach for this to keep noisy, multi-step research — many searches, page fetches, or comparisons — out of this conversation: only the investigator's final findings return here, not every intermediate result.",
    "The investigator cannot see this conversation, so the task you pass is its entire brief: state what to find out and include any context it needs. It returns a written report you can then use in your answer.",
  ].join(" "),
  inputSchema: z.object({
    task: z
      .string()
      .min(1)
      .describe(
        "The investigator's complete brief: the question or research goal, plus any context it needs (it cannot see this conversation). Be specific about what to find and the form of answer you want.",
      ),
  }),
  // No execute: completed by the client (see module doc), not the server.
});
