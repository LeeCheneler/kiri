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

// The input value worth showing in the collapsed summary — the search query for
// web_search; nothing for inputs without a string `query`.
const summaryQuery = (input: unknown): string | null => {
  if (input !== null && typeof input === "object") {
    const { query } = input as { query?: unknown };
    if (typeof query === "string") return query;
  }
  return null;
};

const isWebSearchOutput = (output: unknown): output is WebSearchOutput =>
  output !== null &&
  typeof output === "object" &&
  Array.isArray((output as { results?: unknown }).results);

// Result content is untrusted, so only http(s) URLs become links; a
// `javascript:`/`data:` URL renders as inert text rather than a clickable href.
const isHttpUrl = (url: string): boolean => /^https?:\/\//i.test(url);

function WebSearchResults({ output }: { output: WebSearchOutput }) {
  return (
    <div className="space-y-3 font-mono text-sm">
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

function ToolPanel({ part }: { part: ToolPart }) {
  if (part.state === "output-error") {
    return (
      <p role="alert" className="font-mono text-sm text-status-failed">
        {part.errorText}
      </p>
    );
  }
  if (part.state === "output-available") {
    return isWebSearchOutput(part.output) ? (
      <WebSearchResults output={part.output} />
    ) : (
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
 * search results render as titled links with plain-text snippets (untrusted
 * data, never markdown); any other tool's output falls back to formatted JSON.
 */
export function ToolInvocation({ part }: { part: ToolPart }) {
  const name = getToolName(part);
  const query = summaryQuery(part.input);
  const status = STATE_STATUS[part.state] ?? "working";
  return (
    <div className="border border-rule" data-tool={name}>
      <Disclosure
        summary={
          <span className="flex items-baseline gap-3 font-mono text-xs">
            <span className="uppercase tracking-widest text-ink-muted">{humanizeName(name)}</span>
            {query ? <span className="min-w-0 truncate text-ink">{query}</span> : null}
            <span className="ml-auto shrink-0">
              <Status status={status} />
            </span>
          </span>
        }
      >
        <ToolPanel part={part} />
      </Disclosure>
    </div>
  );
}
