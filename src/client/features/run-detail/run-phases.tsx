import type { ReactNode } from "react";
import { resolvePublishName } from "../../../shared/publish-name.ts";
import type { RunDetailRun, RunStepRow, WorkflowStepSummary } from "../../api.ts";
import { CodeBlock } from "../../design-system/content/code.tsx";
import { Disclosure } from "../../design-system/content/disclosure.tsx";
import { Eyebrow } from "../../design-system/content/eyebrow.tsx";
import { Status, type StatusKind } from "../../design-system/feedback/status.tsx";
import { formatDuration } from "../../formatters/format-time.ts";
import { LiveDuration } from "./live-duration.tsx";

const SHELL_PREVIEW_LIMIT = 60;

// The label for a declared step or summariser entry: its explicit `name` when
// set, else the bundle it runs (`use: <name>`) or a truncated preview of its
// inline shell (`sh: …`).
const stepLabel = (step: WorkflowStepSummary): string => {
  if (step.name) return step.name;
  if ("use" in step) return `use: ${step.use}`;
  const firstLine = (step.sh.split("\n", 1)[0] ?? "").trim();
  const preview =
    firstLine.length > SHELL_PREVIEW_LIMIT
      ? `${firstLine.slice(0, SHELL_PREVIEW_LIMIT)}…`
      : firstLine;
  return `sh: ${preview}`;
};

interface PhaseItem {
  key: string;
  ordinal: number;
  title: string;
  status: StatusKind;
  /** The persisted step row, once the runner has reached this entry. */
  row: RunStepRow | undefined;
}

/**
 * Project the run's declared phases (from its definition snapshot) onto the
 * persisted step rows, by execution index: steps first, then publishes, then
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
      title: stepLabel(step),
      status: row?.status ?? "pending",
      row,
    };
  });

  const publishes = snap.publish ?? [];
  const publishItems: PhaseItem[] = publishes.map((entry, pi) => {
    const row = rowByIndex.get(snap.steps.length + pi);
    return {
      key: row?.id ?? `publish-${pi}`,
      ordinal: pi + 1,
      title: resolvePublishName(entry.slug, entry.name),
      status: row?.status ?? "pending",
      row,
    };
  });

  let summarizeItem: PhaseItem | null = null;
  if (snap.summarize) {
    const row = rowByIndex.get(snap.steps.length + publishes.length);
    summarizeItem = {
      key: row?.id ?? "summarise",
      ordinal: 1,
      title: stepLabel(snap.summarize),
      status: row?.status ?? "pending",
      row,
    };
  }

  return { stepItems, publishItems, summarizeItem };
};

/**
 * The run's execution as up-to-three labelled groups — Steps, Publishes, and
 * Summarise — mirroring the order the runner walks them. Each group lists its
 * entries with status and duration (a live timer while running, the final span
 * once finished); rows that have executed expand to reveal their captured
 * stdout, stderr, and any error. Empty groups (no publishes, no summariser) are
 * omitted. `now` is injectable so tests pin the live timer; production omits it.
 */
export function RunPhases({
  run,
  steps,
  now,
}: { run: RunDetailRun; steps: RunStepRow[]; now?: Date }) {
  const { stepItems, publishItems, summarizeItem } = buildPhases(run, steps);
  return (
    <div className="mt-10 space-y-10">
      <PhaseGroup label="Steps" items={stepItems} now={now} />
      {publishItems.length > 0 ? (
        <PhaseGroup label="Publishes" items={publishItems} now={now} />
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
      <span
        className={`min-w-0 flex-1 truncate font-mono text-sm ${
          item.status === "pending" ? "text-ink-muted" : "text-ink"
        }`}
      >
        {item.title}
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
      <StepTrace row={item.row} />
    </Disclosure>
  );
}

function StepDuration({ row, now }: { row: RunStepRow | undefined; now?: Date }) {
  if (!row?.startedAt) return <>—</>;
  if (!row.finishedAt) return <LiveDuration startedAt={row.startedAt} now={now} />;
  return <>{formatDuration(row.startedAt, row.finishedAt)}</>;
}

function StepTrace({ row }: { row: RunStepRow }) {
  return (
    <div className="space-y-4">
      <TracePart label="stdout" body={row.traces?.stdout ?? ""} />
      <TracePart label="stderr" body={row.traces?.stderr ?? ""} />
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

function TracePart({ label, body }: { label: string; body: string }): ReactNode {
  return (
    <div>
      <Eyebrow tone="muted">{label}</Eyebrow>
      <div className="mt-1.5">
        {body ? (
          <CodeBlock>{body}</CodeBlock>
        ) : (
          <p className="font-mono text-xs text-ink-faint italic">(empty)</p>
        )}
      </div>
    </div>
  );
}
