import { type DynamicToolUIPart, type ToolUIPart, getToolName } from "ai";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";

type ToolPart = ToolUIPart | DynamicToolUIPart;

// The web_search tool's output shape, as it rides the persisted message part.
interface WebResult {
  title: string;
  url: string;
  content: string;
}
interface WebSearchOutput {
  answer?: string;
  results: WebResult[];
}

// The web_extract tool's output shape, as it rides the persisted message part.
interface WebExtractResult {
  url: string;
  content: string;
}
interface WebExtractFailure {
  url: string;
  error: string;
}
interface WebExtractOutput {
  results: WebExtractResult[];
  failed: WebExtractFailure[];
}

// A tool's run state mapped to the shared status vocabulary: still resolving →
// working, finished → ok, errored → failed.
const STATE_STATUS: Record<string, StatusKind> = {
  "input-streaming": "working",
  "input-available": "working",
  "output-available": "ok",
  "output-error": "failed",
};

// "web_search" → "Web search".
const humanizeName = (name: string): string => {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// The input detail worth showing in the collapsed summary — the search query
// for web_search, or the target URL(s) for web_extract; nothing otherwise.
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

const isWebSearchOutput = (output: unknown): output is WebSearchOutput =>
  output !== null &&
  typeof output === "object" &&
  Array.isArray((output as { results?: unknown }).results);

// web_extract shares web_search's `results` array, so it's distinguished by its
// `failed` array; check this before isWebSearchOutput when routing output.
const isWebExtractOutput = (output: unknown): output is WebExtractOutput =>
  output !== null &&
  typeof output === "object" &&
  Array.isArray((output as { results?: unknown }).results) &&
  Array.isArray((output as { failed?: unknown }).failed);

// Result content is untrusted, so only http(s) URLs become links; a
// `javascript:`/`data:` URL renders as inert text rather than a clickable href.
const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

function WebSearchResults({ output }: { output: WebSearchOutput }) {
  // break-words cascades (overflow-wrap is inherited) so long URLs and unbroken
  // content wrap within the box instead of spilling out of it horizontally.
  return (
    <div className="space-y-3 break-words font-mono text-sm">
      {output.answer ? <p className="whitespace-pre-wrap text-ink">{output.answer}</p> : null}
      <ul className="space-y-2">
        {output.results.map((result) => (
          <li key={result.url} className="space-y-0.5">
            {isHttpUrl(result.url) ? (
              <InlineLink href={result.url}>{result.title || result.url}</InlineLink>
            ) : (
              <span className="text-ink">{result.title || result.url}</span>
            )}
            {result.content ? (
              <p className="whitespace-pre-wrap text-ink-muted">{result.content}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WebExtractResults({ output }: { output: WebExtractOutput }) {
  // break-words cascades (overflow-wrap is inherited) so long URLs and full-page
  // content wrap within the box instead of spilling out of it horizontally.
  return (
    <div className="space-y-3 break-words font-mono text-sm">
      <ul className="space-y-3">
        {output.results.map((result) => (
          <li key={result.url} className="space-y-0.5">
            {isHttpUrl(result.url) ? (
              <InlineLink href={result.url}>{result.url}</InlineLink>
            ) : (
              <span className="text-ink">{result.url}</span>
            )}
            {result.content ? (
              <p className="whitespace-pre-wrap text-ink-muted">{result.content}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {output.failed.length > 0 ? (
        <ul className="space-y-0.5 text-status-failed">
          {output.failed.map((failure) => (
            <li key={failure.url}>{`${failure.url}: ${failure.error}`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ToolPanel({ part }: { part: ToolPart }) {
  if (part.state === "output-error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        {part.errorText}
      </p>
    );
  }
  if (part.state === "output-available") {
    if (isWebExtractOutput(part.output)) return <WebExtractResults output={part.output} />;
    if (isWebSearchOutput(part.output)) return <WebSearchResults output={part.output} />;
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
 * tool, what it was called with, and its status, expanding to the result. Web
 * search and web extract results render as links with plain-text snippets or
 * page content (untrusted data, never markdown); any other tool's output falls
 * back to formatted JSON.
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
            that, so a long page or result set stays contained in the box. */}
        <div className="max-h-[17.5rem] overflow-y-auto">
          <ToolPanel part={part} />
        </div>
      </Disclosure>
    </div>
  );
}
