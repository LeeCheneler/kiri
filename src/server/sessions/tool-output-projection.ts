import {
  type JSONValue,
  type ToolSet,
  type UIMessage,
  getToolName,
  isToolUIPart,
  jsonSchema,
  tool,
} from "ai";
import { BUILTIN_TOOLS } from "./builtin-tools.ts";
import { compactImageOutput } from "./image-tool-results.ts";
import { compactWriteOutput } from "./write-tool-diffs.ts";

/** What the model receives for a settled tool result: text sent verbatim, or JSON. */
export type ProjectedToolOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue };

// Keyed by the tool's name as history records it, never by the tools a turn
// is offered: a result outlives its tool being switched off or unconfigured,
// and its payload still has to stay away from the model.
const PAYLOAD_STRIPS: ReadonlyMap<string, (output: unknown) => unknown> = new Map(
  BUILTIN_TOOLS.flatMap((tool) =>
    tool.output === undefined
      ? []
      : [[tool.name, tool.output === "diff" ? compactWriteOutput : compactImageOutput] as const],
  ),
);

/**
 * A tool result minus the app-only payload its descriptor declares — the diff
 * or image the transcript renders and the model has no use for. A tool that
 * declares none, or one kiri doesn't know, passes through untouched.
 */
export function projectToolOutput(name: string, output: unknown): unknown {
  const strip = PAYLOAD_STRIPS.get(name);
  return strip === undefined ? output : strip(output);
}

/**
 * The one serialisation of a settled tool result for the model, the same
 * whether the result was just produced or is replayed from history: the
 * tool's declared payload is stripped, then a string is sent as text and
 * anything else as JSON. Errored calls never reach this — the SDK reports
 * them from their error text.
 */
export function toolModelOutput(name: string, output: unknown): ProjectedToolOutput {
  const projected = projectToolOutput(name, output);
  if (typeof projected === "string") return { type: "text", value: projected };
  return { type: "json", value: (projected ?? null) as JSONValue };
}

/**
 * The conversion hooks for sending `history` to the model: one entry per tool
 * the history names, each carrying only `toModelOutput`. Built from the
 * history rather than from the tools a turn is offered, so a result keeps its
 * projection after its tool is switched off, unconfigured, or disconnected.
 * The entries have nothing to execute and are meant for
 * `convertToModelMessages` alone — serialising a result never offers its tool.
 * The history itself is left untouched, so what is stored keeps every payload
 * for the app to render.
 */
export function historyProjectionTools(history: UIMessage[]): ToolSet {
  const tools: ToolSet = {};
  for (const message of history) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const name = getToolName(part);
      tools[name] ??= tool({
        inputSchema: jsonSchema({}),
        toModelOutput: ({ output }) => toolModelOutput(name, output),
      });
    }
  }
  return tools;
}
