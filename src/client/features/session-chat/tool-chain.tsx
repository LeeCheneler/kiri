import { type UIMessage, getToolName, isToolUIPart } from "ai";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import {
  ToolInvocation,
  type ToolPart,
  generatedImage,
  humanizeName,
  toolStatus,
} from "./tool-invocation.tsx";

/**
 * A renderable slice of an assistant message: a piece of prose, a call awaiting
 * the user's approval, a settled call whose result is a generated image, a
 * delegate call rendered as its embedded child session, or a chain of
 * consecutive tool calls that folds into one panel. `index` on a text segment
 * is the part's position in the message, kept as a stable render key.
 */
export type Segment =
  | { kind: "text"; index: number; text: string }
  | { kind: "approval"; part: ToolPart }
  | { kind: "image"; part: ToolPart }
  | { kind: "delegate"; part: ToolPart }
  | { kind: "chain"; parts: ToolPart[] };

/**
 * Fold an assistant message's parts into renderable segments. Consecutive tool
 * calls join one chain — step boundaries, empty text, and other non-rendering
 * parts sit between chained calls and don't break one — while non-empty prose
 * does. A call awaiting approval always stands alone, so its Allow / Deny
 * prompt can't be folded out of sight; a settled generated image stands alone
 * the same way — it is content like prose, not plumbing to fold up — as does a
 * delegate call, which renders as an embedded child-session box.
 */
export function segmentParts(parts: UIMessage["parts"]): Segment[] {
  const segments: Segment[] = [];
  let chain: ToolPart[] = [];
  const flush = () => {
    if (chain.length > 0) segments.push({ kind: "chain", parts: chain });
    chain = [];
  };
  parts.forEach((part, index) => {
    if (part.type === "text" && part.text !== "") {
      flush();
      segments.push({ kind: "text", index, text: part.text });
    } else if (isToolUIPart(part)) {
      if (part.state === "approval-requested") {
        flush();
        segments.push({ kind: "approval", part });
      } else if (getToolName(part) === "delegate") {
        flush();
        segments.push({ kind: "delegate", part });
      } else if (generatedImage(part) !== null) {
        flush();
        segments.push({ kind: "image", part });
      } else {
        chain.push(part);
      }
    }
    // Anything else renders nothing and neither joins nor breaks a chain.
  });
  flush();
  return segments;
}

// The chain's rolled-up status: the most urgent of its calls' statuses. A call
// still running outranks a settled failure, which outranks a cancellation;
// all-ok reads as ok. Approvals never join a chain, so pending can't occur.
const STATUS_PRECEDENCE: StatusKind[] = ["working", "failed", "cancelled"];
const chainStatus = (parts: ToolPart[]): StatusKind => {
  const statuses = new Set(parts.map(toolStatus));
  return STATUS_PRECEDENCE.find((status) => statuses.has(status)) ?? "ok";
};

/**
 * A run of consecutive tool calls folded into one collapsible panel: the call
 * count, the distinct tools used, and a rolled-up status, expanding to the
 * individual calls as their own collapsible rows. Expects at least two calls —
 * a lone call renders as a plain `ToolInvocation` instead.
 */
export function ToolChain({ parts }: { parts: ToolPart[] }) {
  const names = [...new Set(parts.map((part) => humanizeName(getToolName(part))))].join(", ");
  return (
    <div className="border border-rule">
      <Disclosure
        summary={
          <span className="flex items-baseline gap-3 font-mono text-xs">
            <span className="shrink-0 uppercase tracking-widest text-ink-muted">
              {parts.length} tool calls
            </span>
            <span className="min-w-0 truncate text-ink">{names}</span>
            <span className="ml-auto shrink-0">
              <Status status={chainStatus(parts)} />
            </span>
          </span>
        }
      >
        <div className="divide-y divide-rule border border-rule">
          {parts.map((part) => (
            <ToolInvocation key={part.toolCallId} part={part} framed={false} />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
