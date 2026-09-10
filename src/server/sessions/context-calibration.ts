import { createHash } from "node:crypto";
import type { ModelMessage, UIMessage } from "ai";
import { estimateContextTokens } from "./session-context.ts";

interface ContextRequest {
  model: string;
  contextWindow?: number;
  providerOptions?: unknown;
  system?: string;
  messages: ModelMessage[];
  tools: unknown[];
}

/** A measured request, stored as hashes and counts rather than duplicated prompt content. */
export interface ContextCalibration {
  version: 2;
  model: string;
  optionsHash: string;
  estimate: number;
  inputTokens: number;
  components: Array<{ hash: string; tokens: number }>;
}

const PART_TYPE = "data-context-calibration";

// Object property order can change when SDK messages round-trip through storage.
const digest = (value: unknown): string =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item instanceof ArrayBuffer
          ? { bytes: Buffer.from(item).toString("base64") }
          : item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, item[key]]),
              )
            : item,
      ),
    )
    .digest("hex");

/** Fingerprint each request component so replacements and repeated content are charged independently. */
export function contextSnapshot(request: ContextRequest): Omit<ContextCalibration, "inputTokens"> {
  const components: ContextCalibration["components"] = [];
  // Request framing is already covered by the measurement, not added per part.
  const framing = estimateContextTokens({ messages: [] });
  if (request.system)
    components.push({
      hash: digest({ system: request.system }),
      tokens: estimateContextTokens({ system: request.system, messages: [] }) - framing,
    });
  for (const tool of request.tools)
    components.push({
      hash: digest({ tool }),
      tokens: estimateContextTokens({ messages: [], tools: [tool] }) - framing,
    });
  for (const message of request.messages) {
    const content =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content;
    for (const part of content) {
      const single = { ...message, content: [part] } as ModelMessage;
      components.push({
        hash: digest(single),
        tokens: estimateContextTokens({ messages: [single] }) - framing,
      });
    }
  }
  return {
    version: 2,
    model: request.model,
    optionsHash: digest({
      contextWindow: request.contextWindow,
      providerOptions: request.providerOptions,
    }),
    estimate: estimateContextTokens({
      system: request.system,
      messages: request.messages,
      tools: request.tools,
    }),
    components,
  };
}

/** Reuse measured input with 10% headroom; charge changed/new components without subtracting removed input. */
export function measuredContextTokens(
  request: Omit<ContextCalibration, "inputTokens">,
  previous: ContextCalibration | undefined,
): number {
  if (
    !previous ||
    previous.version !== request.version ||
    previous.model !== request.model ||
    previous.optionsHash !== request.optionsHash ||
    !Number.isFinite(previous.inputTokens) ||
    previous.inputTokens <= 0 ||
    !Number.isFinite(previous.estimate) ||
    previous.estimate <= 0
  )
    return request.estimate;
  const remaining = new Map<string, number>();
  for (const { hash } of previous.components) remaining.set(hash, (remaining.get(hash) ?? 0) + 1);
  let added = 0;
  for (const { hash, tokens } of request.components) {
    const count = remaining.get(hash) ?? 0;
    if (count > 0) remaining.set(hash, count - 1);
    else added += tokens;
  }
  const measured = previous.inputTokens * 1.1;
  return Math.ceil(measured + added * Math.max(1, measured / previous.estimate));
}

/** Read only server-saved assistant measurements after the latest context checkpoint. */
export function savedContextCalibration(history: UIMessage[]): ContextCalibration | undefined {
  for (const message of history.toReversed()) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts.toReversed()) {
      if (part.type === "data-checkpoint") return undefined;
      if (part.type === PART_TYPE) return (part as { data: ContextCalibration }).data;
    }
  }
}

/** Remove bookkeeping before SDK conversion, including otherwise empty assistant blocks. */
export function withoutContextCalibration(history: UIMessage[]): UIMessage[] {
  return history.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type !== PART_TYPE),
  }));
}

/** Persist the latest measured request with an assistant message; never changes its visible transcript. */
export function withContextCalibration(
  message: UIMessage,
  calibration: ContextCalibration | undefined,
): UIMessage {
  return {
    ...message,
    parts: [
      ...message.parts.filter((part) => part.type !== PART_TYPE),
      ...(calibration
        ? [{ type: PART_TYPE, data: calibration } satisfies UIMessage["parts"][number]]
        : []),
    ],
  };
}
