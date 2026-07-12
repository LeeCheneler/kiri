import { type DynamicToolUIPart, type ToolUIPart, getToolName } from "ai";
import type { ReactNode } from "react";
import { Button } from "../../design-system/actions/button.tsx";
import { Diff, patchFromStrings } from "../../design-system/content/diff.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";

/** A tool-call part of an assistant message, static or dynamic. */
export type ToolPart = ToolUIPart | DynamicToolUIPart;

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

/** A tool name as readable copy: "create_issue" → "Create issue". */
export const humanizeName = (name: string): string => {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * A tool call's run state in the shared status vocabulary, reading a cancelled
 * call (which rides on `output-error`) as cancelled rather than failed.
 */
export const toolStatus = (part: ToolPart): StatusKind =>
  part.state === "output-error" && part.errorText === CANCELLED_ERROR_TEXT
    ? "cancelled"
    : (STATE_STATUS[part.state] ?? "working");

// A short input detail for the collapsed summary, when the call carries an
// obvious one — a string `query`, a `path` (the filesystem tools), or a list
// of `urls`; nothing otherwise.
const summaryDetail = (input: unknown): string | null => {
  if (input === null || typeof input !== "object") return null;
  const { query, path, urls } = input as { query?: unknown; path?: unknown; urls?: unknown };
  if (typeof query === "string") return query;
  if (typeof path === "string") return path;
  if (Array.isArray(urls)) {
    const list = urls.filter((url): url is string => typeof url === "string").join(", ");
    return list === "" ? null : list;
  }
  return null;
};

// A settled filesystem write's change as a renderable patch: the unified diff
// its result carries for an overwrite or edit, or — for a created file, whose
// result carries none — its content from the call's input, shown as additions.
const fileChange = (
  name: string,
  input: unknown,
  output: unknown,
): { patch: string; truncated: boolean } | null => {
  if (name !== "write_file" && name !== "edit_file") return null;
  if (output === null || typeof output !== "object") return null;
  const { diff, diffTruncated, created } = output as {
    diff?: unknown;
    diffTruncated?: unknown;
    created?: unknown;
  };
  if (typeof diff === "string") return { patch: diff, truncated: diffTruncated === true };
  if (created === true && input !== null && typeof input === "object") {
    const { content } = input as { content?: unknown };
    if (typeof content === "string")
      return { patch: patchFromStrings("", content), truncated: false };
  }
  return null;
};

// A change preview for a filesystem write awaiting approval, derived from the
// call's input alone: an edit as its old lines removed and new lines added, a
// write as its full content added. Null for calls with nothing diffable to
// show (deletes, directories) — the JSON input serves those.
const approvalPreview = (name: string, input: unknown): ReactNode | null => {
  if (input === null || typeof input !== "object") return null;
  if (name === "edit_file") {
    const { old_string, new_string, replace_all } = input as {
      old_string?: unknown;
      new_string?: unknown;
      replace_all?: unknown;
    };
    if (typeof old_string !== "string" || typeof new_string !== "string") return null;
    return (
      <div className="space-y-2">
        <Diff patch={patchFromStrings(old_string, new_string)} />
        {replace_all === true && (
          <p className="font-mono text-ink-muted text-xs">Applies to every occurrence.</p>
        )}
      </div>
    );
  }
  if (name === "write_file") {
    const { content } = input as { content?: unknown };
    if (typeof content !== "string") return null;
    return <Diff patch={patchFromStrings("", content)} />;
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

function ToolPanel({ part, name }: { part: ToolPart; name: string }) {
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
    // A filesystem write's result renders as the change itself — the unified
    // diff (or a created file's content), still untrusted text shown verbatim,
    // never markdown.
    const change = fileChange(name, part.input, part.output);
    if (change) return <Diff patch={change.patch} truncated={change.truncated} />;
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
 * A filesystem write shows the change it would make as a diff-style preview in
 * place of the raw JSON input.
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
  const detail = summaryDetail(part.input);
  const preview = approvalPreview(name, part.input);
  return (
    <div className="border border-rule" data-tool={name}>
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-baseline gap-3 font-mono text-xs">
          <span className="shrink-0 uppercase tracking-widest text-ink-muted">
            {humanizeName(name)}
          </span>
          {detail ? <span className="min-w-0 truncate text-ink">{detail}</span> : null}
          <span className="ml-auto shrink-0">
            <Status status="pending" />
          </span>
        </div>
        <p className="font-mono text-ink text-sm">
          The assistant wants to run this tool. Review its input, then decide.
        </p>
        {/* Cap the preview like an expanded result, so a huge write stays contained. */}
        <div className="max-h-[17.5rem] overflow-y-auto">
          {preview ?? <ToolInput input={part.input} />}
        </div>
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
 * data and renders as formatted JSON, never markdown. `framed` (default true)
 * draws the block's own bordered box; pass false when the row sits inside a
 * container that provides its own framing.
 */
export function ToolInvocation({
  part,
  onDecision,
  framed = true,
}: {
  part: ToolPart;
  onDecision?: ToolDecisionHandler;
  framed?: boolean;
}) {
  const name = getToolName(part);
  if (part.state === "approval-requested" && onDecision) {
    return <ToolApproval part={part} name={name} onDecision={onDecision} />;
  }
  const detail = summaryDetail(part.input);
  const status = toolStatus(part);
  return (
    <div className={framed ? "border border-rule" : undefined} data-tool={name}>
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
          <ToolPanel part={part} name={name} />
        </div>
      </Disclosure>
    </div>
  );
}
