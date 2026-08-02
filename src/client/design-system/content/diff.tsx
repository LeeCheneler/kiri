const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

type DiffRowKind = "hunk" | "added" | "removed" | "context" | "meta";

interface DiffRow {
  kind: DiffRowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

// Parse a unified diff body — hunk headers and prefixed lines, no file-name
// preamble — into renderable rows, numbering lines from each hunk header. A
// patch without headers (a pseudo-diff built by patchFromStrings) that is
// purely additions or purely removals — a whole file arriving or going — is
// numbered from 1; a mixed one has no line positions to know, so its rows
// carry no numbers.
function parsePatch(patch: string): DiffRow[] {
  if (patch === "") return [];
  const rows: DiffRow[] = [];
  let sawHunk = false;
  let oldNo: number | undefined;
  let newNo: number | undefined;
  for (const line of patch.split("\n")) {
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    const text = line.slice(1);
    if (line.startsWith("+")) {
      rows.push({ kind: "added", newNo, text });
      if (newNo !== undefined) newNo += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "removed", oldNo, text });
      if (oldNo !== undefined) oldNo += 1;
    } else if (line.startsWith("\\")) {
      // jsdiff's "\ No newline at end of file" marker.
      rows.push({ kind: "meta", text: line.slice(2) });
    } else {
      rows.push({ kind: "context", oldNo, newNo, text });
      if (oldNo !== undefined) oldNo += 1;
      if (newNo !== undefined) newNo += 1;
    }
  }
  if (!sawHunk) {
    const kinds = new Set(rows.map((row) => row.kind));
    if (kinds.size === 1 && (kinds.has("added") || kinds.has("removed"))) {
      rows.forEach((row, index) => {
        if (row.kind === "added") row.newNo = index + 1;
        else row.oldNo = index + 1;
      });
    }
  }
  return rows;
}

const ROW_TONES: Record<DiffRowKind, string> = {
  hunk: "bg-paper-2 text-ink-faint",
  added: "bg-status-ok/10 text-status-ok",
  removed: "bg-status-failed/10 text-status-failed",
  context: "text-ink",
  meta: "text-ink-faint",
};

const ROW_MARKERS: Record<DiffRowKind, string> = {
  hunk: "",
  added: "+",
  removed: "-",
  context: "",
  meta: "",
};

/** A file change as a unified diff body, plus whether the server cut it short. */
export interface DiffProps {
  patch: string;
  truncated?: boolean;
}

/**
 * Unified-diff panel — a bordered mono block rendering a file change line by
 * line: hunk headers as faint separators carrying old/new line numbers into
 * the gutter, additions in the ok tone, removals in the failed tone. Accepts
 * the hunk-only patches the filesystem write tools produce and the
 * header-less pseudo-diffs of `patchFromStrings` — a purely one-sided pseudo
 * (a whole file arriving or going) is numbered from 1, a mixed one carries no
 * numbers, and only gutters with numbers to show take up space. Renders
 * nothing for an empty patch.
 */
export function Diff({ patch, truncated }: DiffProps) {
  const rows = parsePatch(patch);
  if (rows.length === 0 && truncated !== true) return null;
  // Only gutters that carry numbers earn their column — a real diff shows
  // old and new, a numbered pseudo-diff one side, an unnumbered one neither.
  const hasOld = rows.some((row) => row.oldNo !== undefined);
  const hasNew = rows.some((row) => row.newNo !== undefined);
  const gutters = (oldNo?: number, newNo?: number) => (
    <>
      {hasOld && (
        <span className="w-10 shrink-0 select-none pr-2 text-right text-ink-faint">
          {oldNo ?? ""}
        </span>
      )}
      {hasNew && (
        <span className="w-10 shrink-0 select-none pr-2 text-right text-ink-faint">
          {newNo ?? ""}
        </span>
      )}
    </>
  );
  return (
    <div className="overflow-x-auto border border-rule bg-paper font-mono text-sm">
      <div className="w-max min-w-full">
        {rows.map((row, index) => (
          <div
            // Rows are a parse of static text — index keys are stable here.
            key={`${index}-${row.kind}`}
            className={`flex ${ROW_TONES[row.kind]}`}
            data-diff-line={row.kind}
          >
            {gutters(row.oldNo, row.newNo)}
            <span className="w-4 shrink-0 select-none text-center">{ROW_MARKERS[row.kind]}</span>
            <span className="whitespace-pre pr-4">{row.text}</span>
          </div>
        ))}
        {truncated === true && (
          <div className="flex text-ink-faint" data-diff-line="note">
            {gutters()}
            <span className="w-4 shrink-0" />
            <span className="whitespace-pre pr-4">… diff truncated</span>
          </div>
        )}
      </div>
    </div>
  );
}

// A line-per-row split that drops the phantom empty line a trailing newline
// would otherwise produce.
const toLines = (content: string): string[] => {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/**
 * Build a header-less pseudo-diff from whole before/after strings: every
 * before line as a removal, every after line as an addition. For previews
 * where only the two sides are known — an edit awaiting approval, a created
 * file's content — rather than a real computed diff.
 */
export function patchFromStrings(before: string, after: string): string {
  return [...toLines(before).map((l) => `-${l}`), ...toLines(after).map((l) => `+${l}`)].join("\n");
}
