import { type DynamicToolUIPart, type ToolUIPart, isToolUIPart } from "ai";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import type { SessionDetail } from "../../api.ts";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { useInvestigation, useSession } from "../../state/sessions.ts";
import { ToolInvocation } from "./tool-invocation.tsx";
import { useSessionConversation } from "./use-session-conversation.ts";

type ToolPart = ToolUIPart | DynamicToolUIPart;

/** What the box needs from the parent: who spawned it, and where to send the report. */
export interface InvestigationProps {
  /** The parent session whose investigate call this box runs. */
  parentSessionId: string;
  /** Deliver the finished report back to the parent's pending investigate call, resuming its turn. */
  onReport: (toolCallId: string, report: string) => void;
}

// The brief the model passed in the investigate call.
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
function InvestigationSummary({ task, status }: { task: string; status: StatusKind }) {
  return (
    <span className="flex items-baseline gap-3 font-mono text-xs">
      <span className="shrink-0 uppercase tracking-widest text-ink-muted">Investigation</span>
      {task ? <span className="min-w-0 truncate text-ink">{task}</span> : null}
      <span className="ml-auto shrink-0">
        <Status status={status} />
      </span>
    </span>
  );
}

// The box frame: an investigation tool block. Collapsed to its summary by default
// like any tool call (expand to read the worker's transcript), but rendered open
// while a child tool awaits approval so the prompt isn't hidden. The transcript
// is capped in height and scrolls past that, so a long investigation stays
// contained.
function InvestigationShell({
  task,
  status,
  expanded,
  children,
}: {
  task: string;
  status: StatusKind;
  expanded?: boolean;
  children?: ReactNode;
}) {
  const body = <div className="max-h-[17.5rem] space-y-3 overflow-y-auto">{children}</div>;
  return (
    <div className="border border-rule" data-tool="investigate">
      {children === undefined ? (
        <div className="px-4 py-3">
          <InvestigationSummary task={task} status={status} />
        </div>
      ) : expanded ? (
        <div className="space-y-3 px-4 py-3">
          <InvestigationSummary task={task} status={status} />
          {body}
        </div>
      ) : (
        <Disclosure summary={<InvestigationSummary task={task} status={status} />}>
          {body}
        </Disclosure>
      )}
    </div>
  );
}

/**
 * Renders an `investigate` tool call as a box that runs the investigation as a
 * child session and shows its work inline. Resolves (get-or-creates) the child
 * for this call, then drives and renders it; the report is sent back to the
 * parent via `onReport` once it settles.
 */
export function Investigation({
  part,
  parentSessionId,
  onReport,
}: { part: ToolPart } & InvestigationProps) {
  const task = taskOf(part);
  const investigation = useInvestigation(parentSessionId, part.toolCallId);
  if (!investigation.data) return <InvestigationShell task={task} status="working" />;
  return (
    <InvestigationRun childId={investigation.data.id} part={part} task={task} onReport={onReport} />
  );
}

// Loads the child's transcript, then hands off to the live view once it settles.
function InvestigationRun({
  childId,
  part,
  task,
  onReport,
}: {
  childId: string;
  part: ToolPart;
  task: string;
  onReport: InvestigationProps["onReport"];
}) {
  const detail = useSession(childId);
  if (!detail.data) return <InvestigationShell task={task} status="working" />;
  return <InvestigationView detail={detail.data} part={part} task={task} onReport={onReport} />;
}

// Drives the child session live: sends the task on first run, streams its work,
// and reports the result back to the parent once the child settles.
function InvestigationView({
  detail,
  part,
  task,
  onReport,
}: {
  detail: SessionDetail;
  part: ToolPart;
  task: string;
  onReport: InvestigationProps["onReport"];
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
    onReport(part.toolCallId, report !== "" ? report : "The investigation did not complete.");
  }, [conv.busy, conv.awaitingApproval, conv.messages, detail.session.status, part, onReport]);

  const status: StatusKind =
    part.state === "output-available"
      ? "ok"
      : conv.awaitingApproval
        ? "pending"
        : conv.busy
          ? "working"
          : "ok";

  return (
    <InvestigationShell task={task} status={status} expanded={conv.awaitingApproval}>
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
    </InvestigationShell>
  );
}
