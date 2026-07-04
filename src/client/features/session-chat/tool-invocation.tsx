import { type DynamicToolUIPart, type ToolUIPart, getToolName } from "ai";
import { Button } from "../../design-system/actions/button.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";

type ToolPart = ToolUIPart | DynamicToolUIPart;

// Marker carried as a cancelled tool call's `errorText`. Cancelling a turn
// stops an in-flight call mid-flight (the AI SDK has no terminal "cancelled"
// tool state of its own), so the transcript records it as an `output-error`
// tagged with this text and renders it as cancelled rather than failed.
export const CANCELLED_ERROR_TEXT = "Cancelled.";

/** A user's verdict on a tool the assistant wants to run. */
export type ToolDecision = "allow" | "always" | "deny";

/** Resolve a pending tool-approval request with the user's verdict. */
export type ToolDecisionHandler = (part: ToolPart, decision: ToolDecision) => void;

// A tool's run state mapped to the shared status vocabulary: still resolving →
// working, awaiting the user's decision → pending, finished → ok, errored →
// failed, refused → cancelled.
const STATE_STATUS: Record<string, StatusKind> = {
  "input-streaming": "working",
  "input-available": "working",
  "approval-requested": "pending",
  "approval-responded": "working",
  "output-available": "ok",
  "output-error": "failed",
  "output-denied": "cancelled",
};

// "create_issue" → "Create issue".
const humanizeName = (name: string): string => {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// A short input detail for the collapsed summary, when the call carries an
// obvious one — a string `query` or a list of `urls`; nothing otherwise.
const summaryDetail = (input: unknown): string | null => {
  if (input === null || typeof input !== "object") return null;
  const { query, urls } = input as { query?: unknown; urls?: unknown };
  if (typeof query === "string") return query;
  if (Array.isArray(urls)) {
    const list = urls.filter((url): url is string => typeof url === "string").join(", ");
    return list === "" ? null : list;
  }
  return null;
};

// The call's input rendered as formatted JSON — untrusted data, shown verbatim.
function ToolInput({ input }: { input: unknown }) {
  return (
    <pre className="overflow-x-auto font-mono text-ink-muted text-xs">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function ToolPanel({ part }: { part: ToolPart }) {
  if (part.state === "output-error") {
    if (part.errorText === CANCELLED_ERROR_TEXT) {
      return <p className="font-mono text-ink-muted text-sm">You cancelled this call.</p>;
    }
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        {part.errorText}
      </p>
    );
  }
  if (part.state === "output-available") {
    // Tool output is untrusted data, never markdown — render it as formatted
    // JSON rather than interpreting it.
    return <ToolInput input={part.output} />;
  }
  if (part.state === "output-denied") {
    return <p className="font-mono text-ink-muted text-sm">You denied this call.</p>;
  }
  // No result yet — the call is still in flight.
  return <p className="font-mono text-ink-muted text-sm">Running…</p>;
}

/**
 * A tool call awaiting the user's go-ahead: the call and its input shown in full
 * so the decision is informed, with Allow (run once), Always allow (run and stop
 * prompting for this tool), and Deny (refuse and let the assistant continue). Shown
 * expanded rather than collapsed — it needs a response before the turn resumes.
 */
function ToolApproval({
  part,
  name,
  onDecision,
}: {
  part: ToolPart;
  name: string;
  onDecision: ToolDecisionHandler;
}) {
  return (
    <div className="border border-rule" data-tool={name}>
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline gap-3 font-mono text-xs">
          <span className="uppercase tracking-widest text-ink-muted">{humanizeName(name)}</span>
          <span className="ml-auto shrink-0">
            <Status status="pending" />
          </span>
        </div>
        <p className="font-mono text-ink text-sm">
          The assistant wants to run this tool. Review its input, then decide.
        </p>
        <ToolInput input={part.input} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => onDecision(part, "allow")}>
            Allow
          </Button>
          <Button variant="default" onClick={() => onDecision(part, "always")}>
            Always allow
          </Button>
          <Button variant="default" onClick={() => onDecision(part, "deny")}>
            Deny
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One tool call in the assistant transcript. A call awaiting approval renders an
 * open Allow / Always allow / Deny prompt (when `onDecision` is wired); every
 * other state renders as a collapsible block showing the tool, what it was
 * called with, and its status, expanding to the result. Tool output is untrusted
 * data and renders as formatted JSON, never markdown.
 */
export function ToolInvocation({
  part,
  onDecision,
}: {
  part: ToolPart;
  onDecision?: ToolDecisionHandler;
}) {
  const name = getToolName(part);
  if (part.state === "approval-requested" && onDecision) {
    return <ToolApproval part={part} name={name} onDecision={onDecision} />;
  }
  const detail = summaryDetail(part.input);
  // A cancelled call rides on `output-error` but reads as cancelled, not failed.
  const status =
    part.state === "output-error" && part.errorText === CANCELLED_ERROR_TEXT
      ? "cancelled"
      : (STATE_STATUS[part.state] ?? "working");
  return (
    <div className="border border-rule" data-tool={name}>
      <Disclosure
        summary={
          <span className="flex items-baseline gap-3 font-mono text-xs">
            <span className="shrink-0 uppercase tracking-widest text-ink-muted">
              {humanizeName(name)}
            </span>
            {detail ? <span className="min-w-0 truncate text-ink">{detail}</span> : null}
            <span className="ml-auto shrink-0">
              <Status status={status} />
            </span>
          </span>
        }
      >
        {/* Cap the expanded result at ~14 lines (of text-sm) and scroll past
            that, so a long result stays contained in the box. */}
        <div className="max-h-[17.5rem] overflow-y-auto">
          <ToolPanel part={part} />
        </div>
      </Disclosure>
    </div>
  );
}
