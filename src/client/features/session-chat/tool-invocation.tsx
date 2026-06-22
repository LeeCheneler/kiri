import { type DynamicToolUIPart, type ToolUIPart, getToolName } from "ai";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";

type ToolPart = ToolUIPart | DynamicToolUIPart;

// A tool's run state mapped to the shared status vocabulary: still resolving →
// working, finished → ok, errored → failed.
const STATE_STATUS: Record<string, StatusKind> = {
  "input-streaming": "working",
  "input-available": "working",
  "output-available": "ok",
  "output-error": "failed",
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

function ToolPanel({ part }: { part: ToolPart }) {
  if (part.state === "output-error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        {part.errorText}
      </p>
    );
  }
  if (part.state === "output-available") {
    // Tool output is untrusted data, never markdown — render it as formatted
    // JSON rather than interpreting it.
    return (
      <pre className="overflow-x-auto font-mono text-ink-muted text-xs">
        {JSON.stringify(part.output, null, 2)}
      </pre>
    );
  }
  // No result yet — the call is still in flight.
  return <p className="font-mono text-ink-muted text-sm">Running…</p>;
}

/**
 * One tool call in the assistant transcript: a collapsible block showing the
 * tool, what it was called with, and its status, expanding to the result. Tool
 * output is untrusted data and renders as formatted JSON, never markdown.
 */
export function ToolInvocation({ part }: { part: ToolPart }) {
  const name = getToolName(part);
  const detail = summaryDetail(part.input);
  const status = STATE_STATUS[part.state] ?? "working";
  return (
    <div className="border border-rule" data-tool={name}>
      <Disclosure
        summary={
          <span className="flex items-baseline gap-3 font-mono text-xs">
            <span className="uppercase tracking-widest text-ink-muted">{humanizeName(name)}</span>
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
