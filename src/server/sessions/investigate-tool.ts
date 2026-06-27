import { type Tool, tool } from "ai";
import { z } from "zod";

export { INVESTIGATE_TOOL_NAME } from "../../shared/investigate.ts";

/**
 * The first-party `investigate` tool: a client-completed tool with no server
 * `execute`. When the model calls it the turn pauses with the call awaiting an
 * output; the client runs the investigation as a child session and supplies its
 * report as the tool output, which resumes the turn. Its description is written
 * for the calling model — when to delegate and how to brief the investigator.
 */
export const investigateTool: Tool = tool({
  description: [
    "Delegate a research task to a separate investigator assistant and get back a concise, sourced summary.",
    "Prefer this over running web search or page-fetch tools yourself: whenever answering needs looking things up — a web search, gathering and comparing sources, checking something current or unfamiliar — hand the whole task to the investigator in one call rather than searching here. It runs the searches and fetches in its own context and returns only the findings, so this conversation stays free of the intermediate results. Use direct search/fetch tools only for a single quick lookup you can act on at once.",
    "The investigator cannot see this conversation, so the task you pass is its entire brief: state what to find out and include any context it needs. It returns a written report you then use in your answer.",
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
