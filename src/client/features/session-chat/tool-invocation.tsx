import { type DynamicToolUIPart, type FileUIPart, type ToolUIPart, getToolName } from "ai";
import type { ReactNode } from "react";
import { CANCELLED_ERROR_TEXT } from "../../../shared/cancelled-tool-call.ts";
import { Button } from "../../design-system/actions/button.tsx";
import { CodeBlock } from "../../design-system/content/code.tsx";
import { Diff, patchFromStrings } from "../../design-system/content/diff.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { FullWidthImage } from "./image-thumb.tsx";

/** A tool-call part of an assistant message, static or dynamic. */
export type ToolPart = ToolUIPart | DynamicToolUIPart;

export { CANCELLED_ERROR_TEXT };

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
// obvious one — a string `query`, a `path` (the filesystem tools), a `command`
// (run_command), a `prompt` (generate_image), a `name` (use_skill), a `slug`
// (the article tools), or a list of `urls`; nothing otherwise.
const summaryDetail = (input: unknown): string | null => {
  if (input === null || typeof input !== "object") return null;
  const { query, path, command, prompt, name, slug, urls } = input as {
    query?: unknown;
    path?: unknown;
    command?: unknown;
    prompt?: unknown;
    name?: unknown;
    slug?: unknown;
    urls?: unknown;
  };
  if (typeof query === "string") return query;
  if (typeof path === "string") return path;
  if (typeof command === "string") return command;
  if (typeof prompt === "string") return prompt;
  if (typeof name === "string") return name;
  if (typeof slug === "string") return slug;
  if (Array.isArray(urls)) {
    const list = urls.filter((url): url is string => typeof url === "string").join(", ");
    return list === "" ? null : list;
  }
  return null;
};

// The tools whose settled result carries a unified diff for the transcript —
// the writes whose before-text only the server knows.
const DIFF_TOOLS = new Set([
  "write_file",
  "edit_file",
  "update_project_instructions",
  "replace_article",
  "replace_workflow",
  "save_memory",
]);

// The exact-string edit tools: the input's old/new pair is the whole change,
// for the file, article, and workflow variants alike.
const EDIT_TOOLS = new Set(["edit_file", "edit_article", "edit_workflow"]);

// The tools that create a document whole, keyed to the input field carrying
// its body. create_article and create_workflow refuse to overwrite, so the
// body shown as additions is the entire change; write_file can overwrite too,
// so it renders this way only when its result says it created the file.
const CREATED_CONTENT_FIELDS: Record<string, string> = {
  write_file: "content",
  create_article: "content_md",
  create_workflow: "content_yaml",
};

// A creation's body from the call's input, or null for other tools and
// malformed inputs.
const createdContent = (name: string, input: unknown): string | null => {
  const field = CREATED_CONTENT_FIELDS[name];
  if (field === undefined || input === null || typeof input !== "object") return null;
  const body = (input as Record<string, unknown>)[field];
  return typeof body === "string" ? body : null;
};

// An exact-string edit's input as a renderable patch, with its replace-all
// flag; null when the input doesn't carry the old/new pair.
const editChange = (input: unknown): { patch: string; replaceAll: boolean } | null => {
  if (input === null || typeof input !== "object") return null;
  const { old_string, new_string, replace_all } = input as {
    old_string?: unknown;
    new_string?: unknown;
    replace_all?: unknown;
  };
  if (typeof old_string !== "string" || typeof new_string !== "string") return null;
  return { patch: patchFromStrings(old_string, new_string), replaceAll: replace_all === true };
};

// A settled write's change as a renderable patch: the unified diff its result
// carries for an overwrite, edit, or instructions rewrite; a created
// document's body from the call's input, shown as additions; or an
// exact-string edit's old/new pair when the result carries no diff of its own
// (the article and workflow edits — the server computes diffs only for the
// filesystem-shaped writes).
const writtenChange = (
  name: string,
  input: unknown,
  output: unknown,
): { patch: string; truncated: boolean } | null => {
  if (output === null || typeof output !== "object") return null;
  const { diff, diffTruncated, created } = output as {
    diff?: unknown;
    diffTruncated?: unknown;
    created?: unknown;
  };
  if (DIFF_TOOLS.has(name) && typeof diff === "string") {
    return { patch: diff, truncated: diffTruncated === true };
  }
  if (name === "write_file" && created !== true) return null;
  const content = createdContent(name, input);
  if (content !== null) return { patch: patchFromStrings("", content), truncated: false };
  if (EDIT_TOOLS.has(name)) {
    const change = editChange(input);
    if (change !== null) return { patch: change.patch, truncated: false };
  }
  return null;
};

// A settled run_command result as terminal-style output: the exit status
// line, then stdout and stderr verbatim — untrusted text, never markdown.
// Falls back to null (the JSON rendering) when the output isn't the tool's
// shape.
const commandResult = (name: string, output: unknown): ReactNode | null => {
  if (name !== "run_command") return null;
  if (output === null || typeof output !== "object") return null;
  const { exitCode, stdout, stderr, durationMs, timedOut, stdoutTruncated, stderrTruncated } =
    output as {
      exitCode?: unknown;
      stdout?: unknown;
      stderr?: unknown;
      durationMs?: unknown;
      timedOut?: unknown;
      stdoutTruncated?: unknown;
      stderrTruncated?: unknown;
    };
  if (typeof stdout !== "string" || typeof stderr !== "string") return null;
  const failed = timedOut === true || (typeof exitCode === "number" && exitCode !== 0);
  const status =
    timedOut === true
      ? "killed at its timeout"
      : `exited ${typeof exitCode === "number" ? exitCode : "before completing"}`;
  const duration = typeof durationMs === "number" ? ` · ${Math.round(durationMs)} ms` : "";
  return (
    <div className="space-y-2 font-mono text-xs">
      <p className={failed ? "text-status-failed" : "text-ink-muted"}>
        {status}
        {duration}
      </p>
      {stdout !== "" && (
        <CodeBlock>
          {stdoutTruncated === true ? "[truncated — tail shown]\n" : ""}
          {stdout}
        </CodeBlock>
      )}
      {stderr !== "" && (
        <div className="space-y-1">
          <Eyebrow tone="muted">stderr</Eyebrow>
          <CodeBlock>
            {stderrTruncated === true ? "[truncated — tail shown]\n" : ""}
            {stderr}
          </CodeBlock>
        </div>
      )}
      {stdout === "" && stderr === "" && <p className="text-ink-muted">No output.</p>}
    </div>
  );
};

/**
 * A settled generate_image result's image as a file part for the shared
 * click-to-preview thumbnail — the result carries it as a data URL. Null for
 * other tools, unsettled calls, and results without one.
 */
export const generatedImage = (part: ToolPart): FileUIPart | null => {
  if (getToolName(part) !== "generate_image" || part.state !== "output-available") return null;
  if (part.output === null || typeof part.output !== "object") return null;
  const { image, mediaType } = part.output as { image?: unknown; mediaType?: unknown };
  if (typeof image !== "string") return null;
  return {
    type: "file",
    mediaType: typeof mediaType === "string" ? mediaType : "image/png",
    filename: "Generated image",
    url: image,
  };
};

// A change preview for a call awaiting approval, derived from its input
// alone: an exact-string edit (file, article, or workflow) as its old lines
// removed and new lines added, a created document's full body as additions,
// and a shell command shown verbatim (with its directory when named) — the
// decision the user is making is precisely "run this". Null for calls with
// nothing better than the JSON input to show (deletes, directories).
const approvalPreview = (name: string, input: unknown): ReactNode | null => {
  if (input === null || typeof input !== "object") return null;
  if (name === "run_command") {
    const { command, cwd } = input as { command?: unknown; cwd?: unknown };
    if (typeof command !== "string") return null;
    // The command sits in a code block so it reads as the machine layer —
    // visually distinct from the prompt copy around it.
    return (
      <div className="space-y-2">
        <CodeBlock>{command}</CodeBlock>
        {typeof cwd === "string" && <p className="font-mono text-ink-muted text-xs">in {cwd}</p>}
      </div>
    );
  }
  if (EDIT_TOOLS.has(name)) {
    const change = editChange(input);
    if (change === null) return null;
    return (
      <div className="space-y-2">
        <Diff patch={change.patch} />
        {change.replaceAll && (
          <p className="font-mono text-ink-muted text-xs">Applies to every occurrence.</p>
        )}
      </div>
    );
  }
  const content = createdContent(name, input);
  if (content !== null) return <Diff patch={patchFromStrings("", content)} />;
  return null;
};

// The tools whose result is one document the user reads, keyed to the field
// carrying its body. The body renders verbatim in a code block instead of a
// JSON-escaped string; the collapsed summary already names the source.
const READ_CONTENT_FIELDS: Record<string, string> = {
  read_file: "content",
  read_article: "content_md",
  read_memory: "content_md",
  read_workflow: "content_yaml",
};

// A settled read's document, with the note a truncated read_file carries.
// use_skill returns its instructions as a bare string; the rest carry the
// body in a per-tool field. Null for other tools and malformed results.
const readContent = (
  name: string,
  output: unknown,
): { content: string; note: string | null } | null => {
  if (name === "use_skill") {
    return typeof output === "string" ? { content: output, note: null } : null;
  }
  const field = READ_CONTENT_FIELDS[name];
  if (field === undefined || output === null || typeof output !== "object") return null;
  const { [field]: body, note } = output as Record<string, unknown>;
  if (typeof body !== "string") return null;
  return { content: body, note: typeof note === "string" ? note : null };
};

// A settled filesystem search or listing as plain lines — matches in grep's
// file:line: text shape, file and directory listings one entry per line —
// with any note (a cap or truncation) above and a quiet message when nothing
// matched. Null for other tools and malformed results, which stay JSON.
const listResult = (
  name: string,
  output: unknown,
): { lines: string[]; note: string | null; empty: string } | null => {
  if (output === null || typeof output !== "object") return null;
  const { files, entries, matches, capped, note } = output as {
    files?: unknown;
    entries?: unknown;
    matches?: unknown;
    capped?: unknown;
    note?: unknown;
  };
  const stringNote = typeof note === "string" ? note : null;
  if (name === "find_files" && Array.isArray(files)) {
    return {
      lines: files.filter((file): file is string => typeof file === "string"),
      note: capped === true ? "capped — narrow the pattern or directory" : stringNote,
      empty: "No files matched.",
    };
  }
  if (name === "list_directory" && Array.isArray(entries)) {
    return {
      lines: entries.filter((entry): entry is string => typeof entry === "string"),
      note: stringNote,
      empty: "Empty directory.",
    };
  }
  if (name === "search_files" && Array.isArray(matches)) {
    const lines: string[] = [];
    for (const match of matches) {
      if (match === null || typeof match !== "object") return null;
      const { file, line, text } = match as { file?: unknown; line?: unknown; text?: unknown };
      if (typeof file !== "string" || typeof line !== "number" || typeof text !== "string")
        return null;
      lines.push(`${file}:${line}: ${text}`);
    }
    return { lines, note: stringNote, empty: "No matches." };
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
    // A write's result renders as the change itself — the unified diff, a
    // created document's content, or an edit's old/new pair — still untrusted
    // text shown verbatim, never markdown.
    const change = writtenChange(name, part.input, part.output);
    if (change) return <Diff patch={change.patch} truncated={change.truncated} />;
    // A shell command's result renders as its exit status and output streams
    // rather than JSON.
    const command = commandResult(name, part.output);
    if (command) return command;
    // A read's document renders verbatim — untrusted text in a code block,
    // never markdown — instead of a JSON-escaped string.
    const read = readContent(name, part.output);
    if (read) {
      return (
        <div className="space-y-2 font-mono text-xs">
          {read.note !== null && <p className="text-ink-muted">{read.note}</p>}
          <CodeBlock>{read.content}</CodeBlock>
        </div>
      );
    }
    // A search or listing renders as plain lines rather than a JSON array.
    const list = listResult(name, part.output);
    if (list) {
      return (
        <div className="space-y-2 font-mono text-xs">
          {list.note !== null && <p className="text-ink-muted">{list.note}</p>}
          {list.lines.length === 0 ? (
            <p className="text-ink-muted">{list.empty}</p>
          ) : (
            <CodeBlock>{list.lines.join("\n")}</CodeBlock>
          )}
        </div>
      );
    }
    // A generated image renders below the block; the expanded panel shows the
    // call's metadata without dumping the data URL's base64 as JSON.
    if (generatedImage(part)) {
      const { image: _image, ...rest } = part.output as Record<string, unknown>;
      return <ToolInput input={rest} />;
    }
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
 * A write — file, article, or workflow — shows the change it would make as a
 * diff-style preview in place of the raw JSON input; a shell command shows the
 * command it would run, verbatim.
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
  const image = generatedImage(part);
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
      {/* The generated image is the call's product for the user — always
          visible below the collapsible detail, never folded away. */}
      {image ? (
        <div className="px-4 pb-4">
          <FullWidthImage part={image} />
        </div>
      ) : null}
    </div>
  );
}
