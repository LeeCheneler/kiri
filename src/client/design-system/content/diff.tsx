// Either side's line count is omitted when the range is a single line, and git
// appends the enclosing function's text after the closing `@@`, so neither the
// counts nor the end of the line can be anchored on.
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// The header a real git patch opens each file with, and the metadata lines that
// follow it up to the first hunk. `---` and `+++` would otherwise parse as a
// removal and an addition, and the rest restates the file name the caller
// already knows.
const FILE_HEADER = "diff --git ";
const PREAMBLE_LINE =
  /^(diff --git |index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |--- |\+\+\+ )/;

type DiffRowKind = "hunk" | "added" | "removed" | "context" | "meta";

interface DiffRow {
  kind: DiffRowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

// A line-per-row split that drops the phantom empty line a trailing newline
// would otherwise produce.
const toLines = (content: string): string[] => {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

// Parse a unified diff into renderable rows, numbering lines from each hunk
// header. Accepts a whole git patch — whose per-file preamble is skipped, bar
// any notice it carries such as "Binary files … differ" — and a bare hunk body
// with no preamble at all. A patch without headers (a pseudo-diff built by
// patchFromStrings) that is purely additions or purely removals — a whole file
// arriving or going — is numbered from 1; a mixed one has no line positions to
// know, so its rows carry no numbers.
function parsePatch(patch: string): DiffRow[] {
  if (patch === "") return [];
  const rows: DiffRow[] = [];
  let sawHunk = false;
  // Only a patch that opens with git's file header has a preamble to skip; a
  // bare hunk body or a pseudo-diff starts straight into content, and skipping
  // anything there would drop a real line.
  const gitPatch = patch.startsWith(FILE_HEADER);
  let inPreamble = gitPatch;
  let oldNo: number | undefined;
  let newNo: number | undefined;
  for (const line of toLines(patch)) {
    const hunk = line.match(HUNK_HEADER);
    if (hunk) {
      sawHunk = true;
      inPreamble = false;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
      continue;
    }
    if (gitPatch && line.startsWith(FILE_HEADER)) inPreamble = true;
    if (inPreamble) {
      if (!PREAMBLE_LINE.test(line)) rows.push({ kind: "meta", text: line });
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
 * the gutter, additions in the ok tone, removals in the failed tone. Accepts a
 * whole git patch — its per-file preamble is skipped, keeping any notice it
 * carries — as well as hunk-only patches and the header-less pseudo-diffs of
 * `patchFromStrings`, where a purely one-sided pseudo (a whole file arriving or
 * going) is numbered from 1 and a mixed one carries no numbers. Only gutters
 * with numbers to show take up space. Renders nothing for an empty patch.
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

/**
 * Build a header-less pseudo-diff from whole before/after strings: every
 * before line as a removal, every after line as an addition. For previews
 * where only the two sides are known — an edit awaiting approval, a created
 * file's content — rather than a real computed diff.
 */
export function patchFromStrings(before: string, after: string): string {
  return [...toLines(before).map((l) => `-${l}`), ...toLines(after).map((l) => `+${l}`)].join("\n");
}
