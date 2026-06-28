import { type DynamicToolUIPart, type ToolUIPart, getToolName, isToolUIPart } from "ai";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { humaniseSlug } from "../../../shared/humanise-slug.ts";
import type { SessionDetail } from "../../api.ts";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { useChildSession, useSession } from "../../state/sessions.ts";
import { ToolInvocation } from "./tool-invocation.tsx";
import { useSessionConversation } from "./use-session-conversation.ts";

type ToolPart = ToolUIPart | DynamicToolUIPart;

/**
 * Wiring for the client-completed tools a view runs as embedded child sessions —
 * supplied by the page that owns the conversation. `toolNames` lists which tools'
 * calls render as a box; `onReport` delivers a child's report back to its call —
 * keyed by tool name — resuming the parent turn.
 */
export interface ChildSessionWiring {
  toolNames: string[];
  /** The parent session whose tool call a box runs. */
  parentSessionId: string;
  /** Deliver a finished report back to the parent's pending call, resuming its turn. */
  onReport: (toolName: string, toolCallId: string, report: string) => void;
}

// A tool name humanised for the box title: `_`/`-` separators (including MCP's
// `<server>__<tool>`) become spaces and each word is title-cased — `investigate`
// → "Investigate", `deep_research` → "Deep Research". Routed through the shared
// slug titlecaser after normalising separators to its hyphen contract.
const toolLabel = (toolName: string): string => humaniseSlug(toolName.replace(/[_-]+/g, "-"));

// The brief the model passed in the spawning call.
const taskOf = (part: ToolPart): string => {
  const input = part.input as { task?: unknown } | undefined;
  return typeof input?.task === "string" ? input.task : "";
};

// The text of an assistant message — its report, with tool-call parts dropped.
const messageText = (parts: { type: string; text?: string }[]): string =>
  parts
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")
    .trim();

// The collapsed/expanded header row: the label, the task it's running, and its
// status — the always-visible summary, mirroring a tool call's collapsed row.
function ChildSessionSummary({
  label,
  task,
  status,
}: { label: string; task: string; status: StatusKind }) {
  return (
    <span className="flex items-baseline gap-3 font-mono text-xs">
      <span className="shrink-0 uppercase tracking-widest text-ink-muted">{label}</span>
      {task ? <span className="min-w-0 truncate text-ink">{task}</span> : null}
      <span className="ml-auto shrink-0">
        <Status status={status} />
      </span>
    </span>
  );
}

// The box frame: a child-session tool block. Collapsed to its summary by default
// like any tool call (expand to read the worker's transcript), but rendered open
// while a child tool awaits approval so the prompt isn't hidden. The transcript
// is capped in height and scrolls past that, so a long session stays contained.
function ChildSessionShell({
  label,
  task,
  status,
  expanded,
  children,
}: {
  label: string;
  task: string;
  status: StatusKind;
  expanded?: boolean;
  children?: ReactNode;
}) {
  const body = <div className="max-h-[17.5rem] space-y-3 overflow-y-auto">{children}</div>;
  return (
    <div className="border border-rule" data-tool="child-session">
      {children === undefined ? (
        <div className="px-4 py-3">
          <ChildSessionSummary label={label} task={task} status={status} />
        </div>
      ) : expanded ? (
        <div className="space-y-3 px-4 py-3">
          <ChildSessionSummary label={label} task={task} status={status} />
          {body}
        </div>
      ) : (
        <Disclosure summary={<ChildSessionSummary label={label} task={task} status={status} />}>
          {body}
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Renders a client-completed tool call as a box that runs the work as a child
 * session and shows its transcript inline. Resolves (get-or-creates) the child
 * for this call, then drives and renders it; the report is sent back to the
 * parent via `onReport` once it settles.
 */
export function ChildSession({
  part,
  parentSessionId,
  onReport,
}: {
  part: ToolPart;
  parentSessionId: string;
  onReport: ChildSessionWiring["onReport"];
}) {
  const task = taskOf(part);
  const label = toolLabel(getToolName(part));
  const child = useChildSession(parentSessionId, part.toolCallId);
  if (!child.data) return <ChildSessionShell label={label} task={task} status="working" />;
  return (
    <ChildSessionRun
      childId={child.data.id}
      part={part}
      label={label}
      task={task}
      onReport={onReport}
    />
  );
}

// Loads the child's transcript, then hands off to the live view once it settles.
function ChildSessionRun({
  childId,
  part,
  label,
  task,
  onReport,
}: {
  childId: string;
  part: ToolPart;
  label: string;
  task: string;
  onReport: ChildSessionWiring["onReport"];
}) {
  const detail = useSession(childId);
  if (!detail.data) return <ChildSessionShell label={label} task={task} status="working" />;
  return (
    <ChildSessionView
      detail={detail.data}
      part={part}
      label={label}
      task={task}
      onReport={onReport}
    />
  );
}

// Drives the child session live: sends the task on first run, streams its work,
// and reports the result back to the parent once the child settles.
function ChildSessionView({
  detail,
  part,
  label,
  task,
  onReport,
}: {
  detail: SessionDetail;
  part: ToolPart;
  label: string;
  task: string;
  onReport: ChildSessionWiring["onReport"];
}) {
  const initialMessages = useMemo(
    () => detail.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    [detail.messages],
  );
  const conv = useSessionConversation({ session: detail.session, initialMessages });

  // Start the child's one turn with the task, once. A child that already has
  // messages (a reload, or one driven before) is left to reconcile, not re-sent.
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    if (conv.messages.length === 0 && task !== "") {
      void conv.sendMessage({ parts: [{ type: "text", text: task }] });
    }
  }, [conv.messages.length, conv.sendMessage, task]);

  // Report back once the child settles — its final answer, or a note if it
  // failed — resuming the parent's paused turn. Only while the call still awaits
  // its output, and only once.
  const reportedRef = useRef(false);
  useEffect(() => {
    if (reportedRef.current || part.state !== "input-available") return;
    if (conv.busy || conv.awaitingApproval) return;
    const failed = detail.session.status === "failed" || detail.session.status === "cancelled";
    const last = conv.messages.at(-1);
    const report = last?.role === "assistant" ? messageText(last.parts) : "";
    if (!failed && report === "") return;
    reportedRef.current = true;
    onReport(
      getToolName(part),
      part.toolCallId,
      report !== "" ? report : `The ${label.toLowerCase()} call did not complete.`,
    );
  }, [
    conv.busy,
    conv.awaitingApproval,
    conv.messages,
    detail.session.status,
    part,
    label,
    onReport,
  ]);

  const status: StatusKind =
    part.state === "output-available"
      ? "ok"
      : conv.awaitingApproval
        ? "pending"
        : conv.busy
          ? "working"
          : "ok";

  return (
    <ChildSessionShell label={label} task={task} status={status} expanded={conv.awaitingApproval}>
      {conv.messages
        .filter((message) => message.role === "assistant")
        .map((message) => (
          <div key={message.id} className="space-y-3">
            {message.parts.map((p, index) => {
              if (p.type === "text" && p.text !== "")
                // biome-ignore lint/suspicious/noArrayIndexKey: assistant parts are append-only within a turn and never reorder.
                return <Markdown key={index} content={p.text} />;
              if (isToolUIPart(p))
                return (
                  <ToolInvocation
                    key={p.toolCallId}
                    part={p}
                    onDecision={conv.onToolDecision}
                    onCancel={conv.busy ? conv.cancel : undefined}
                  />
                );
              return null;
            })}
          </div>
        ))}
    </ChildSessionShell>
  );
}
