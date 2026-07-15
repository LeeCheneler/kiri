import { type KeyboardEvent, type MouseEvent, useId, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { SearchResults, SearchSnippetSegment } from "../../api.ts";
import { TextInput } from "../../design-system/actions/text-input.tsx";
import { EmptyState } from "../../design-system/content/empty-state.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { LoadingState } from "../../design-system/content/loading-state.tsx";
import { Notice } from "../../design-system/feedback/notice.tsx";
import { Modal } from "../../design-system/surfaces/modal.tsx";
import { useSearch } from "../../state/search.ts";
import { useDebouncedValue } from "./use-debounced-value.ts";

/** How long the input must hold still before the query fires. */
const DEBOUNCE_MS = 150;

// One row in the flattened result list: what it shows and where it goes.
// Flattening the groups gives the keyboard a single 0..n-1 walk order.
interface ResultRow {
  key: string;
  href: string;
  label: string;
  detail?: SearchSnippetSegment[] | string;
}

interface ResultGroup {
  heading: string;
  rows: ResultRow[];
}

const articleHref = (hit: SearchResults["articles"][number]): string =>
  hit.runId !== null
    ? `/runs/${encodeURIComponent(hit.runId)}/articles/${encodeURIComponent(hit.slug)}`
    : `/sessions/${encodeURIComponent(hit.sessionId ?? "")}/articles/${encodeURIComponent(hit.slug)}`;

const toGroups = (results: SearchResults): ResultGroup[] =>
  [
    {
      heading: "Articles",
      rows: results.articles.map((hit) => ({
        key: `article-${hit.id}`,
        href: articleHref(hit),
        label: hit.name,
        detail: hit.snippet,
      })),
    },
    {
      heading: "Sessions",
      rows: results.sessions.map((hit) => ({
        key: `session-${hit.id}`,
        href: `/sessions/${encodeURIComponent(hit.id)}`,
        label: hit.preview === "" ? "Untitled session" : hit.preview,
        detail: hit.snippet,
      })),
    },
    {
      heading: "Runs",
      rows: results.runs.map((hit) => ({
        key: `run-${hit.id}`,
        href: `/runs/${encodeURIComponent(hit.id)}`,
        label: hit.workflowName,
        detail: hit.snippet,
      })),
    },
    {
      heading: "Workflows",
      rows: results.workflows.map((hit) => ({
        key: `workflow-${hit.name}`,
        href: `/workflows/${encodeURIComponent(hit.name)}`,
        label: hit.name,
        detail: hit.description,
      })),
    },
  ].filter((group) => group.rows.length > 0);

function Snippet({ segments }: { segments: SearchSnippetSegment[] }) {
  return (
    <span className="mt-0.5 block truncate font-mono text-ink-faint text-xs">
      {segments.map((segment, index) =>
        segment.match ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are a positional decomposition of one string — they have no identity beyond position.
          <mark key={index} className="bg-transparent font-semibold text-accent">
            {segment.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Full-page search overlay: an autofocused query box over grouped, ranked
 * results (articles, sessions, runs, workflows). Results load as the user
 * types, debounced; ↑/↓ walk the list from the input, Enter or a click opens
 * the result and closes the overlay. Rendered while mounted — the parent
 * unmounts it via `onClose` (Escape and backdrop click included, through the
 * underlying `Modal`).
 */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, DEBOUNCE_MS);
  const results = useSearch(debounced);
  const [, navigate] = useLocation();
  const inputId = useId();
  const anchorsRef = useRef<(HTMLAnchorElement | null)[]>([]);

  const groups = results.data === undefined ? [] : toGroups(results.data);
  const rowCount = groups.reduce((count, group) => count + group.rows.length, 0);
  // The ref list is rebuilt from scratch each render via the register
  // callbacks below; trim stale entries when the result set shrinks.
  anchorsRef.current.length = rowCount;

  const focusRow = (index: number) => anchorsRef.current[index]?.focus();

  const onInputKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" && rowCount > 0) {
      event.preventDefault();
      focusRow(0);
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(Math.min(index + 1, rowCount - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) document.getElementById(inputId)?.focus();
      else focusRow(index - 1);
    }
  };

  const open = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    navigate(href);
    onClose();
  };

  const blank = debounced.trim() === "";

  return (
    <Modal title="Search" onClose={onClose} size="lg">
      <div onKeyDown={onInputKeyDown}>
        <label htmlFor={inputId} className="sr-only">
          Search
        </label>
        <TextInput
          id={inputId}
          value={query}
          onChange={setQuery}
          placeholder="Search articles, sessions, runs, and workflows…"
        />
      </div>
      <div className="mt-4 max-h-96 overflow-y-auto">
        {blank ? (
          <p className="font-mono text-ink-faint text-sm">
            Type to search articles, sessions, runs, and workflows.
          </p>
        ) : results.isError ? (
          <Notice tone="negative" announce="polite" title="Search failed">
            Something went wrong running the search. Try again.
          </Notice>
        ) : results.isPending ? (
          <LoadingState>Searching…</LoadingState>
        ) : rowCount === 0 ? (
          <EmptyState>No results for “{debounced.trim()}”.</EmptyState>
        ) : (
          groups.map((group, groupIndex) => {
            // Flat index of this group's first row, for the keyboard walk.
            const offset = groups
              .slice(0, groupIndex)
              .reduce((count, g) => count + g.rows.length, 0);
            return (
              <section key={group.heading} className="mt-4 first:mt-0">
                <Eyebrow tone="muted">{group.heading}</Eyebrow>
                <ul className="mt-1">
                  {group.rows.map((row, rowIndex) => {
                    const index = offset + rowIndex;
                    return (
                      <li key={row.key}>
                        <a
                          href={row.href}
                          ref={(el) => {
                            anchorsRef.current[index] = el;
                          }}
                          onClick={(event) => open(event, row.href)}
                          onKeyDown={(event) => onRowKeyDown(event, index)}
                          className="block border border-transparent px-3 py-2 outline-none hover:bg-paper-2 focus-visible:border-accent"
                        >
                          <span className="block truncate font-mono text-ink text-sm">
                            {row.label}
                          </span>
                          {row.detail === undefined ? null : typeof row.detail === "string" ? (
                            <span className="mt-0.5 block truncate font-mono text-ink-faint text-xs">
                              {row.detail}
                            </span>
                          ) : (
                            <Snippet segments={row.detail} />
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </Modal>
  );
}
