import type { ReactNode } from "react";
import { resolveArticleName } from "../../../shared/article-name.ts";
import type { RunDetailRun, RunStepRow } from "../../api.ts";
import { CodeBlock } from "../../design-system/content/code.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { InlineLink } from "../../design-system/content/inline-link.tsx";
import { Log } from "../../design-system/content/log.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { formatDuration } from "../../formatters/format-time.ts";
import { stepTitle } from "../workflow-details/entry-config.tsx";
import { LiveDuration } from "./live-duration.tsx";

type LlmUsageCounts = NonNullable<NonNullable<RunStepRow["traces"]>["usage"]>;

interface PhaseItem {
  key: string;
  ordinal: number;
  title: string;
  status: StatusKind;
  /**
   * The entry's ref handle — a step's declared `id` or an article's `slug`:
   * what `{ step: <id> }` / `{ article: <slug> }` env refs point at.
   */
  handle?: string;
  /** Link through to the entry's published article, once one exists. */
  href?: string;
  /** The persisted step row, once the runner has reached this entry. */
  row: RunStepRow | undefined;
}

/**
 * Project the run's declared phases (from its definition snapshot) onto the
 * persisted step rows, by execution index: steps first, then articles, then
 * the summariser. A declared entry the runner hasn't reached yet has no row
 * and shows as `pending`; once a row exists it carries the real status and
 * timing. Ordinals restart per group so each reads "01, 02, …".
 */
const buildPhases = (run: RunDetailRun, steps: RunStepRow[]) => {
  const rowByIndex = new Map(steps.map((row) => [row.index, row]));
  const snap = run.definitionSnapshot;

  const stepItems: PhaseItem[] = snap.steps.map((step, i) => {
    const row = rowByIndex.get(i);
    return {
      key: row?.id ?? `step-${i}`,
      ordinal: i + 1,
      title: stepTitle(step),
      status: row?.status ?? "pending",
      handle: step.id,
      row,
    };
  });

  // An article row only exists in `run.articles` once its entry published, so
  // presence there is what turns the phase row into a link through to the page.
  const publishedSlugs = new Set(run.articles.map((article) => article.slug));
  const articleEntries = snap.articles ?? [];
  const articleItems: PhaseItem[] = articleEntries.map((entry, pi) => {
    const row = rowByIndex.get(snap.steps.length + pi);
    return {
      key: row?.id ?? `article-${pi}`,
      ordinal: pi + 1,
      title: resolveArticleName(entry.slug, entry.name),
      status: row?.status ?? "pending",
      handle: entry.slug,
      href: publishedSlugs.has(entry.slug) ? `/runs/${run.id}/articles/${entry.slug}` : undefined,
      row,
    };
  });

  let summarizeItem: PhaseItem | null = null;
  if (snap.summarize) {
    const row = rowByIndex.get(snap.steps.length + articleEntries.length);
    summarizeItem = {
      key: row?.id ?? "summarise",
      ordinal: 1,
      title: stepTitle(snap.summarize),
      status: row?.status ?? "pending",
      row,
    };
  }

  return { stepItems, articleItems, summarizeItem };
};

/**
 * The run's execution as up-to-three labelled groups — Steps, Articles, and
 * Summarise — mirroring the order the runner walks them. Each group lists its
 * entries with status and duration (a live timer while running, the final span
 * once finished). An executed row expands to what the step produced: its
 * console — stdout and stderr merged in arrival order, growing live while the
 * step runs, held to its last few lines until opened — plus any named
 * outputs, token counts, and error. A published
 * article's expanded row leads with a link through to its article page. The
 * step's own definition (script, model, prompt, env) is not repeated here;
 * that lives on the workflow page's Schema tab. Empty groups (no articles, no
 * summariser) are omitted. `now` is injectable so tests pin the live timer;
 * production omits it.
 */
export function RunPhases({
  run,
  steps,
  now,
}: { run: RunDetailRun; steps: RunStepRow[]; now?: Date }) {
  const { stepItems, articleItems, summarizeItem } = buildPhases(run, steps);
  return (
    <div className="mt-10 space-y-10">
      <PhaseGroup label="Steps" items={stepItems} now={now} />
      {articleItems.length > 0 ? (
        <PhaseGroup label="Articles" items={articleItems} now={now} />
      ) : null}
      {summarizeItem ? <PhaseGroup label="Summarise" items={[summarizeItem]} now={now} /> : null}
    </div>
  );
}

function PhaseGroup({ label, items, now }: { label: string; items: PhaseItem[]; now?: Date }) {
  return (
    <section>
      <Eyebrow tone="muted">{label}</Eyebrow>
      <ul className="mt-3 divide-y divide-rule border-rule border-t border-b">
        {items.map((item) => (
          <li key={item.key}>
            <PhaseRow item={item} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PhaseRow({ item, now }: { item: PhaseItem; now?: Date }) {
  const summary = (
    <div className="flex items-baseline gap-4">
      <span className="shrink-0 font-mono text-xs text-ink-faint tabular-nums">
        {String(item.ordinal).padStart(2, "0")}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-3">
        <span
          className={`truncate font-mono text-sm ${
            item.status === "pending" ? "text-ink-muted" : "text-ink"
          }`}
        >
          {item.title}
        </span>
        {item.handle && (
          <span className="shrink-0 font-mono text-xs text-ink-faint">{item.handle}</span>
        )}
      </span>
      <span className="shrink-0 text-xs">
        <Status status={item.status} />
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-ink-muted tabular-nums">
        <StepDuration row={item.row} now={now} />
      </span>
    </div>
  );

  // Only an executed row has traces to reveal; a pending entry is a static row.
  if (!item.row) {
    return <div className="px-4 py-3">{summary}</div>;
  }
  return (
    <Disclosure summary={summary}>
      <StepTrace row={item.row} href={item.href} />
    </Disclosure>
  );
}

function StepDuration({ row, now }: { row: RunStepRow | undefined; now?: Date }) {
  if (!row?.startedAt) return <>—</>;
  if (!row.finishedAt) return <LiveDuration startedAt={row.startedAt} now={now} />;
  return <>{formatDuration(row.startedAt, row.finishedAt)}</>;
}

function StepTrace({ row, href }: { row: RunStepRow; href?: string }) {
  const usage = row.traces?.usage;
  // Rows persisted before merged capture fall back to the split streams
  // joined — there is no interleaving to recover for them.
  const consoleBody = row.traces
    ? (row.traces.console ?? [row.traces.stdout, row.traces.stderr].filter(Boolean).join("\n"))
    : "";
  return (
    <div className="space-y-4">
      {href ? (
        <div>
          <Eyebrow tone="muted">article</Eyebrow>
          <p className="mt-1.5 font-mono text-sm">
            <InlineLink href={href}>read the article →</InlineLink>
          </p>
        </div>
      ) : null}
      <TracePart label="console" body={consoleBody} />
      {row.outputs ? <StepOutputs outputs={row.outputs} /> : null}
      {usage ? <LlmUsage usage={usage} /> : null}
      {row.error ? (
        <div>
          <Eyebrow tone="muted">error</Eyebrow>
          <pre className="mt-1.5 font-mono text-xs break-words whitespace-pre-wrap text-status-failed">
            {row.error.message}
          </pre>
          {row.error.stack ? (
            <pre className="mt-2 font-mono text-xs break-words whitespace-pre-wrap text-ink-muted">
              {row.error.stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Per-call token counts for an `llm:` step — input, output, and total,
 * each shown only when the provider reported it. Counts only, no cost; an
 * all-empty usage object renders nothing.
 */
function LlmUsage({ usage }: { usage: LlmUsageCounts }): ReactNode {
  const counts = [
    { label: "input", value: usage.inputTokens },
    { label: "output", value: usage.outputTokens },
    { label: "total", value: usage.totalTokens },
  ].filter((c) => c.value !== undefined);
  if (counts.length === 0) return null;
  return (
    <div>
      <Eyebrow tone="muted">tokens</Eyebrow>
      <dl className="mt-1.5 flex gap-6 font-mono text-xs">
        {counts.map((c) => (
          <div key={c.label} className="flex items-baseline gap-2">
            <dt className="text-ink-muted">{c.label}</dt>
            <dd className="text-ink tabular-nums">{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The named values a step emitted through its `outputs:` channel — what
 * later phases' `{ step, output }` refs resolved to. Each value renders in
 * its own code block since outputs can be multiline. An emitted-but-empty
 * map (possible only for rows written before ingest validation) renders
 * nothing.
 */
function StepOutputs({ outputs }: { outputs: Record<string, string> }): ReactNode {
  const entries = Object.entries(outputs);
  if (entries.length === 0) return null;
  return (
    <div>
      <Eyebrow tone="muted">outputs</Eyebrow>
      <dl className="mt-1.5 space-y-3">
        {entries.map(([name, value]) => (
          <div key={name}>
            <dt className="font-mono text-xs text-ink-muted">{name}</dt>
            <dd className="mt-1">
              <CodeBlock>{value}</CodeBlock>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Lines of console shown before the reader opens the pane; the newest are kept in view. */
const CONSOLE_LINES = 10;

function TracePart({ label, body }: { label: string; body: string }): ReactNode {
  return (
    <div>
      <Eyebrow tone="muted">{label}</Eyebrow>
      <div className="mt-1.5">
        {body ? (
          <Log lines={CONSOLE_LINES}>{body}</Log>
        ) : (
          <p className="font-mono text-xs text-ink-faint italic">(empty)</p>
        )}
      </div>
    </div>
  );
}
