import { type Tool, tool } from "ai";
import { z } from "zod";

/**
 * The name the investigate tool is registered under and offered to the model —
 * co-located with the tool so its definition and its name live together.
 */
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
    "Delegate a research task to a separate investigator assistant and get back a written, sourced report — without the searching it does ever entering this conversation.",
    "Reach for it whenever answering needs looking things up: a web search, gathering and comparing sources, checking something current or unfamiliar, or any multi-step digging. The investigator runs every search and fetch in its own separate context and hands back only the findings, so this conversation never fills with raw results — keeping them out is the entire point of the tool.",
    "Brief it fully in one call. It cannot see this conversation, so the task is its whole brief: state everything you need answered, every specific and constraint, and the form of answer you want, so one investigation settles the question.",
    "What comes back is your research, done. Answer from the report directly — do not then run web-search or page-fetch tools yourself, and do not re-verify what it already established. Repeating its work re-pays the exact token cost you delegated to avoid and floods this context with the raw results the tool exists to keep out. If the report genuinely left a gap, send a follow-up investigation rather than searching here.",
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

/**
 * The prompt overlay for an investigation child session — the research and
 * sourcing flavour layered onto the generic child-session worker prompt. Lives
 * with the tool so its model-facing description and its worker's guidance stay
 * together; resolved for a child by the tool that spawned it.
 */
export const INVESTIGATE_CHILD_GUIDANCE = [
  "This is a research task: search, fetch, and cross-check across sources until you can answer the whole brief with confidence — don't stop at the first hit or hand back a partial picture.",
  "Give the parent the concrete specifics it needs to act without looking anything up itself — names, figures, models, prices, dates, and the caveats that matter — each with its source cited inline as a URL. Distil to what answers the task; never paste whole fetched pages or long quotes.",
].join("\n");
