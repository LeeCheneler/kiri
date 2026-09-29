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

/** A settled tool result as text, JSON, or MCP text/image content for the model. */
export type ProjectedToolOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue }
  | {
      type: "content";
      value: (
        | { type: "text"; text: string }
        | { type: "image-data"; data: string; mediaType: string }
      )[];
    };

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_TOOLS.map((tool) => tool.name));

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
 * Project a live or historical result identically, without needing its tool
 * to remain connected. Strips built-in app-only payloads and preserves MCP
 * text/image content; other results become text or JSON. Tool errors are
 * reported separately by the SDK.
 */
export function toolModelOutput(name: string, output: unknown): ProjectedToolOutput {
  const projected = projectToolOutput(name, output);
  if (
    !BUILTIN_NAMES.has(name) &&
    projected !== null &&
    typeof projected === "object" &&
    "content" in projected &&
    Array.isArray(projected.content)
  ) {
    // Match the MCP adapter's content representation on both sides of a turn
    // boundary; wrapping historical content in JSON changes the cached prefix.
    return {
      type: "content",
      value: projected.content.map((part: unknown) => {
        if (part !== null && typeof part === "object" && "type" in part) {
          if (part.type === "text" && "text" in part && typeof part.text === "string") {
            return { type: "text", text: part.text };
          }
          if (
            part.type === "image" &&
            "data" in part &&
            typeof part.data === "string" &&
            "mimeType" in part &&
            typeof part.mimeType === "string"
          ) {
            return { type: "image-data", data: part.data, mediaType: part.mimeType };
          }
        }
        return { type: "text", text: JSON.stringify(part) ?? "null" };
      }),
    };
  }
  if (typeof projected === "string") return { type: "text", value: projected };
  return { type: "json", value: (projected ?? null) as JSONValue };
}

/**
 * Give every tool the same live projection used for its historical results,
 * preserving MCP media and stripping built-in app-only payloads on both paths.
 */
export function withLiveProjection(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, offered]) => [
      name,
      {
        ...offered,
        toModelOutput: ({ output }: { output: unknown }) => toolModelOutput(name, output),
      },
    ]),
  );
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
