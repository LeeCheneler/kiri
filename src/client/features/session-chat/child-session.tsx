import { isToolUIPart } from "ai";
import { useMemo } from "react";
import { isInboxPart } from "../../../shared/inbox-part.ts";
import type { Session, SessionDetail, SessionStatus } from "../../api.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Markdown } from "../../design-system/content/markdown.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { useSession, useSessionChildren } from "../../state/sessions.ts";
import { InboxInterjection } from "./chat-message.tsx";
import { ToolInvocation, type ToolPart, toolStatus } from "./tool-invocation.tsx";
import { useSessionConversation } from "./use-session-conversation.ts";

// The brief the model passed in the spawning call.
const taskOf = (part: ToolPart): string => {
  const input = part.input as { task?: unknown } | undefined;
  return typeof input?.task === "string" ? input.task : "";
};

// The short name the model gave the delegation; empty on calls spawned before
// the title prop existed, where the row falls back to the task brief.
const titleOf = (part: ToolPart): string => {
  const input = part.input as { title?: unknown } | undefined;
  return typeof input?.title === "string" ? input.title : "";
};

// A child session's lifecycle in the shared status vocabulary: still working,
// settled fine, or terminal.
const childStatus = (status: SessionStatus): StatusKind =>
  status === "running" ? "working" : status === "idle" ? "ok" : status;

// The collapsed/expanded header row: the label, the delegation's title, and its
// status — the always-visible summary, mirroring a tool call's collapsed row.
function ChildSessionSummary({ title, status }: { title: string; status: StatusKind }) {
  return (
    <span className="flex items-baseline gap-3 font-mono text-xs">
      <span className="shrink-0 uppercase tracking-widest text-ink-muted">Delegate</span>
      {title ? <span className="min-w-0 truncate text-ink">{title}</span> : null}
      <span className="ml-auto shrink-0">
        <Status status={status} />
      </span>
    </span>
  );
}

// The worker's transcript: its assistant turns — the task brief renders
// above the transcript — with prose as markdown and inner tool calls as the
// usual collapsible blocks, plus the messages the delegation exchange weaves
// in (the parent's steers, delivered mid-turn or opening a wake turn), so
// the box reads as the conversation it is. Untrusted content renders exactly
// as it would in the child's own page.
function ChildTranscript({ detail }: { detail: SessionDetail }) {
  const initialMessages = useMemo(
    () => detail.messages.map((m) => ({ id: m.id, role: m.role, parts: m.parts })),
    [detail.messages],
  );
  const { messages, busy, cancel, liveConsoles } = useSessionConversation({
    session: detail.session,
    initialMessages,
  });
  return (
    <div className="space-y-3">
      <div className="max-h-[17.5rem] space-y-3 overflow-y-auto">
        {messages
          .filter(
            (message) =>
              message.role === "assistant" ||
              (message.parts.length > 0 && message.parts.every(isInboxPart)),
          )
          .map((message) => (
            <div key={message.id} className="space-y-3">
              {message.parts.map((part, index) => {
                if (part.type === "text" && part.text !== "")
                  // biome-ignore lint/suspicious/noArrayIndexKey: assistant parts are append-only within a turn and never reorder.
                  return <Markdown key={index} content={part.text} />;
                // The worker's tool calls render as the usual blocks; an
                // in-flight command's expanded panel streams its console here
                // just as it would in the child's own page.
                if (isToolUIPart(part))
                  return (
                    <ToolInvocation key={part.toolCallId} part={part} liveConsoles={liveConsoles} />
                  );
                if (isInboxPart(part)) return <InboxInterjection key={part.id} part={part} />;
                return null;
              })}
            </div>
          ))}
        {messages.every((message) => message.role !== "assistant") ? (
          <p className="font-mono text-ink-muted text-sm">The worker hasn't replied yet.</p>
        ) : null}
      </div>
      <div className="flex items-baseline gap-4 font-mono text-xs">
        <InlineLink href={`/sessions/${detail.session.id}`}>Open session</InlineLink>
        {busy ? (
          <Button variant="default" onClick={cancel}>
            Cancel task
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// Loads the child's persisted transcript, handing off to the live view once it
// arrives; mounted only while the box is expanded, so a collapsed box costs
// nothing and expanding one mid-run rejoins the child's live stream.
function ChildSessionBody({ childId }: { childId: string }) {
  const detail = useSession(childId);
  if (detail.isPending) return <LoadingState>Loading task…</LoadingState>;
  if (detail.isError) {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        Failed to load the delegated task: {detail.error.message}
      </p>
    );
  }
  return <ChildTranscript detail={detail.data} />;
}

/**
 * A delegate tool call rendered as its embedded child session: collapsed to
 * the delegation's title and the child's live status like any tool block,
 * expanding to the task brief and the worker's transcript — its prose and
 * inner tool calls — with a link to the child's own page and a cancel control
 * while it runs. Until the child row exists (it is created moments after the
 * call starts) the box renders just its summary from the call itself,
 * upgrading once the lookup finds the child. A call from before titles
 * existed has none, so the summary falls back to the task brief.
 */
export function ChildSession({
  part,
  parentSessionId,
}: {
  part: ToolPart;
  parentSessionId: string;
}) {
  const task = taskOf(part);
  const title = titleOf(part);
  const children = useSessionChildren(parentSessionId);
  const child: Session | undefined = children.data?.find(
    (candidate) => candidate.parentToolCallId === part.toolCallId,
  );
  if (!child) {
    return (
      <div className="border border-rule" data-tool="delegate">
        <div className="px-4 py-3">
          <ChildSessionSummary title={title || task} status={toolStatus(part)} />
        </div>
      </div>
    );
  }
  return (
    <div className="border border-rule" data-tool="delegate">
      <Disclosure
        summary={<ChildSessionSummary title={title || task} status={childStatus(child.status)} />}
      >
        <div className="space-y-3">
          {/* Untitled legacy calls already lead with the task, so repeating it here would double up. */}
          {title && task ? <p className="font-mono text-ink-muted text-xs">{task}</p> : null}
          <ChildSessionBody childId={child.id} />
        </div>
      </Disclosure>
    </div>
  );
}
