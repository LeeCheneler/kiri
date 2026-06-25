import type { ToolSet } from "ai";

// A tool offered to a session, in the registry's namespaced ToolSet.
type RegistryTool = ToolSet[string];

// Cap on a single tool result, in bytes. A tool's output is fed straight back
// to the model, so an unbounded result — a directory tree over a huge folder,
// say — can blow the model's context or exceed the provider's request-size
// limit. Mirrors the run-context stream cap, a notch larger for richer results.
const MAX_OUTPUT_BYTES = 128 * 1024;

// Time budget for a single tool call. A tool that walks an enormous tree (or
// hangs) would otherwise wedge the turn indefinitely; past the budget the call
// is aborted and surfaced as a tool error the model can react to.
const TIMEOUT_MS = 180_000;

const TRUNCATION_MARKER = "\n[truncated — result too large]";

const encoder = new TextEncoder();
// Non-fatal so a multi-byte character split at the cap is dropped rather than
// decoded to a replacement char or left as an invalid fragment.
const decoder = new TextDecoder("utf-8", { fatal: false });

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface BoundToolOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

// Whether a value is an MCP `CallToolResult` — the `{ content: [...] }` shape
// the AI SDK's MCP tools resolve to, optionally carrying a parsed
// `structuredContent` alongside the textual `content`.
function isContentResult(
  value: unknown,
): value is { content: unknown[]; structuredContent?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray((value as { content: unknown }).content)
  );
}

// One content part as plain text. Images are reduced to a placeholder rather
// than inlining their base64 — that defeats the cap before truncation even runs.
function partToText(part: unknown): string {
  if (typeof part === "object" && part !== null) {
    const { type, text } = part as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") return text;
    if (type === "image") return "[image]";
  }
  return JSON.stringify(part);
}

// Cap a tool result at `maxBytes`. A result under the cap passes through
// untouched (preserving its structure and any non-text parts); over the cap, it
// collapses to a single truncated text part marked as such.
function capResult(output: unknown, maxBytes: number): unknown {
  if (!isContentResult(output)) return output;
  const text = output.content.map(partToText).join("\n");
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return output;
  const head = decoder.decode(bytes.slice(0, maxBytes));
  return { ...output, content: [{ type: "text", text: head + TRUNCATION_MARKER }] };
}

// Reduce an MCP result to a single bounded representation for the model. A result
// that carries `structuredContent` holds the payload twice — as JSON text in
// `content` and as that parsed object — and the model only ever needs one copy,
// yet kiri persists the whole result and replays it to the model on every later
// turn, re-paying the duplicate each time. Forward the structured object when it
// fits the budget: it's the leaner, unescaped form and renders cleanly in the
// transcript. Over budget it can't be truncated without corrupting it, so drop
// the structured copy and fall back to the capped `content` text. A result with
// no `structuredContent` is just capped, unchanged.
function shapeResult(output: unknown, maxBytes: number): unknown {
  if (!isContentResult(output) || output.structuredContent == null) {
    return capResult(output, maxBytes);
  }
  const json = JSON.stringify(output.structuredContent);
  if (encoder.encode(json).length <= maxBytes) return output.structuredContent;
  const { structuredContent: _dropped, ...rest } = output;
  return capResult(rest, maxBytes);
}

/**
 * Wrap an MCP tool so its execution is bounded and de-duplicated: when the result
 * carries a `structuredContent` object it is forwarded in place of the duplicate
 * `content` text (the model needs only one copy), and the result is capped at
 * `maxBytes` — the structured object when it fits, otherwise the `content` text
 * truncated with a marker. The call is given a `timeoutMs` budget; a call that
 * exceeds it is aborted and rejects with a tool error the model can recover from,
 * while the caller's own cancellation passes through unchanged. A tool with no
 * `execute` (never run by the model) is returned as-is.
 */
export function boundMcpTool(toolDef: RegistryTool, options: BoundToolOptions = {}): RegistryTool {
  const original = toolDef.execute;
  if (!original) return toolDef;
  const { maxBytes = MAX_OUTPUT_BYTES, timeoutMs = TIMEOUT_MS } = options;

  const execute = async (...args: Parameters<NonNullable<RegistryTool["execute"]>>) => {
    const [input, opts] = args;
    // The budget rides the same abort signal the model uses to cancel, so a
    // timeout actually aborts the underlying MCP request rather than orphaning it.
    const timeout = AbortSignal.timeout(timeoutMs);
    const abortSignal = opts.abortSignal ? AbortSignal.any([opts.abortSignal, timeout]) : timeout;
    try {
      const output = await original(input, { ...opts, abortSignal });
      return shapeResult(output, maxBytes);
    } catch (cause) {
      // The budget fired and the caller didn't cancel: report it as a tool error
      // so the model can continue. A real cancellation rethrows untouched.
      if (timeout.aborted && !opts.abortSignal?.aborted) {
        throw new Error(`Tool call exceeded the ${Math.round(timeoutMs / 1000)}s time budget.`);
      }
      throw cause;
    }
  };

  return { ...toolDef, execute } as RegistryTool;
}
