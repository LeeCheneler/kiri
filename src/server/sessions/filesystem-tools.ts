import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { type JSONValue, type ToolSet, tool } from "ai";
import { z } from "zod";
import {
  MAX_DIFF_LENGTH,
  unifiedDiff as buildUnifiedDiff,
  compactWriteOutput,
} from "./write-tool-diffs.ts";

// Byte cap on a returned file body; continuation preserves oversized lines.
const MAX_READ_BYTES = 128 * 1024;

// Maximum page sizes for discovery results. More matches can be paged.
const MAX_FIND_RESULTS = 1_000;
const MAX_SEARCH_MATCHES = 200;

// Files larger than this are skipped by content search rather than read into
// memory; a lockfile or generated blob is noise at match time anyway.
const MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;

// Cap on directory entries one find/search visits across all its roots. A
// sandbox can hold millions of files, and a walk that size takes long enough
// that the result would be stale noise — past the cap the walk stops and the
// note tells the model to narrow its scope instead.
const MAX_SCANNED_ENTRIES = 20_000;

// Directory names every walk prunes without descending: dependency stores,
// tool caches, and build output across the common ecosystems. Generated trees
// dwarf the code around them, so a broad find or search would drown in them
// long before the scan budget bites. Only conventionally-generated names that
// rarely hold hand-written source belong here — the pruning is silent, and a
// name like "src" being skipped would be a mystery, not a mercy. A call opts
// back in by naming one: in its pattern or include, or by rooting `directory`
// inside one. Files sharing these names are never pruned, only directories.
const PRUNED_DIR_NAMES = new Set([
  // Dependency stores.
  "node_modules",
  "bower_components",
  "vendor",
  "Pods",
  // Build and coverage output.
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "DerivedData",
  "__pycache__",
  // Framework and tool caches.
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".parcel-cache",
  ".gradle",
  ".terraform",
  ".build",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  // Python virtual environments.
  ".venv",
  "venv",
]);

// Cap on a single reported match line, so one minified line can't dominate the
// result.
const MAX_MATCH_TEXT = 500;

// All three discovery tools share the same offset convention. Pages read
// live filesystem state, so callers must keep their query and scope unchanged.
const pageOffset = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .optional()
  .describe(
    "Zero-based result offset; default 0. Continue with next_offset and unchanged scope/filters. Files may change between calls.",
  );

/**
 * The session's working directory binding: `get` reads the current value
 * (null when the session has none), `set` persists a move the tools have
 * already validated against the sandbox.
 */
export interface SessionCwd {
  get: () => string | null;
  set: (dir: string) => void;
}

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface FilesystemToolsOptions {
  /** Checks scoped instructions synchronously after confinement, before any mutation. */
  checkInstructions?: (directory: string, recursive?: boolean) => void;
  maxReadBytes?: number;
  maxFindResults?: number;
  maxSearchMatches?: number;
  maxSearchFileBytes?: number;
  maxSearchResultBytes?: number;
  maxScannedEntries?: number;
  maxDiffLength?: number;
}

// Whether a buffer looks like binary content: a NUL byte in its head. The
// heuristic git itself uses.
const isBinary = (content: Buffer): boolean => content.subarray(0, 8192).includes(0);

// Written files gain a final newline when missing — the POSIX text-file
// convention models routinely drop. Empty content stays empty: a deliberately
// blank file shouldn't hold a stray blank line.
const withTrailingNewline = (content: string): string =>
  content === "" || content.endsWith("\n") ? content : `${content}\n`;

/**
 * First-party tools that let a session find, list, read, search, and change
 * files — `find_files`, `list_directory`, `read_file`, `search_files`,
 * `write_file`, `edit_file`, `create_directory`, `delete_file`,
 * `delete_directory` — confined to the workspace's declared sandbox, plus
 * `set_working_directory`, which moves the session's working directory
 * (read and persisted through `cwd`) to another sandboxed directory.
 * Results report real absolute paths, so a find_files result feeds straight
 * back into read_file. Model-supplied paths may be absolute or relative: a
 * relative one resolves against the session's working directory, and is
 * rejected with the allowed set named when the session has none. Every path is resolved to its real form (defeating
 * `../` traversal and symlink escapes) and must sit inside one of
 * `getAllowedDirectories()` — read live per call, so a `kiri.yaml` edit
 * applies on the next call. Hidden (dot-prefixed) paths are reachable like any
 * other, bar a narrow denylist that stays outside the tool surface entirely:
 * `.git` internals (thousands of object files that would drown every broad
 * find), secret-bearing files (`.env*`), and kiri's own `.kiri` state
 * directory (credentials, tool permissions, distilled shell precedent) —
 * reads run on the sandbox's authority alone, with no per-call approval to
 * catch a secret entering the transcript, and a session must not author the
 * permission or precedent state that governs it. Broad walks (find_files,
 * search_files) skip dependency, cache, and build-output directories
 * (node_modules, dist, target, .venv, …) unless the call names one, run
 * asynchronously so a big sandbox can't starve the server's event loop, and
 * stop at a scanned-entry budget. Results are
 * capped, with continuation for returned pages and a narrowing hint when the
 * scan budget prevents complete discovery.
 * Expected failures throw with a message naming the call that recovers,
 * surfaced to the model as a tool error so the turn self-corrects.
 */
export function filesystemTools(
  getAllowedDirectories: () => readonly string[],
  cwd: SessionCwd,
  options: FilesystemToolsOptions = {},
): ToolSet {
  const {
    maxReadBytes = MAX_READ_BYTES,
    maxFindResults = MAX_FIND_RESULTS,
    maxSearchMatches = MAX_SEARCH_MATCHES,
    maxSearchFileBytes = MAX_SEARCH_FILE_BYTES,
    maxSearchResultBytes = 128 * 1024,
    maxScannedEntries = MAX_SCANNED_ENTRIES,
    maxDiffLength = MAX_DIFF_LENGTH,
  } = options;

  // A file change's diff for the app's transcript to render, capped so a
  // pathological rewrite can't bloat the persisted message.
  const unifiedDiff = (before: string, after: string) =>
    buildUnifiedDiff(before, after, maxDiffLength);

  // What the model receives in place of a diff-carrying write result: the
  // same object minus the app-only diff fields.
  const modelOutput = ({ output }: { output: unknown }) => ({
    type: "json" as const,
    value: compactWriteOutput(output) as JSONValue,
  });

  // The sandbox as real paths, deduplicated; an entry that doesn't exist on
  // disk can't contain anything and is skipped.
  const sandboxDirs = (): string[] => {
    const dirs = new Set<string>();
    for (const dir of getAllowedDirectories()) {
      try {
        dirs.add(realpathSync(dir));
      } catch {
        // Skipped: a declared directory that doesn't exist.
      }
    }
    return [...dirs];
  };

  const within = (dirs: string[], real: string): string | undefined =>
    dirs.find((dir) => real === dir || real.startsWith(dir + sep));

  // Entry names the tools never touch, even though hidden (dot-prefixed)
  // paths are otherwise reachable: `.git` internals, files that hold secrets
  // (`.env*`) — reads carry no per-call approval to catch a secret entering
  // the transcript — and kiri's own `.kiri` state directory, whose credential,
  // permission, and shell-precedent files a session must not read or author.
  const isBlockedName = (name: string): boolean =>
    name === ".git" || name.startsWith(".env") || name === ".kiri";

  // Whether `real` sits under a blocked segment inside `root`. Also true for
  // a path that escapes `root` (its relative form starts with ".."), which
  // callers treat the same way: not part of this root's visible tree.
  const isBlockedWithin = (root: string, real: string): boolean => {
    const segments = relative(root, real).split(sep);
    return segments[0] === ".." || segments.some(isBlockedName);
  };

  const describeSandbox = (dirs: string[]): string =>
    dirs.length === 0 ? "none are configured" : dirs.map((dir) => `"${dir}"`).join(", ");

  // A model-supplied path made absolute: a relative one resolves against the
  // session's working directory. With no working directory set, only absolute
  // paths are usable — rejected as a recoverable tool error naming the
  // allowed set.
  const absolutize = (dirs: string[], userPath: string): string => {
    if (isAbsolute(userPath)) return userPath;
    const current = cwd.get();
    if (current === null) {
      throw new Error(
        `Relative path "${userPath}" — use an absolute path; the directories kiri may access are ${describeSandbox(dirs)}.`,
      );
    }
    return join(current, userPath);
  };

  // Reject — as a recoverable tool error — a resolved path that sits outside
  // every sandbox directory or under a blocked segment within one.
  const requireWithin = (dirs: string[], userPath: string, real: string): void => {
    const root = within(dirs, real);
    if (root === undefined) {
      throw new Error(
        `"${userPath}" is outside the directories the filesystem tools may access (${describeSandbox(dirs)}) — stay inside them.`,
      );
    }
    if (isBlockedWithin(root, real)) {
      throw new Error(
        `"${userPath}" is off-limits — .git internals, secret-bearing files (.env*), and kiri's own .kiri state are outside the filesystem tools' reach.`,
      );
    }
  };

  // Resolve a model-supplied path — relative ones against the session's
  // working directory — to its real absolute form and reject, as a
  // recoverable tool error, anything outside the sandbox or hidden within it.
  const confine = (userPath: string): string => {
    const dirs = sandboxDirs();
    const target = absolutize(dirs, userPath);
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      throw new Error(`No such path "${userPath}" — call find_files to see what exists.`);
    }
    requireWithin(dirs, userPath, real);
    return real;
  };

  // Confine a path that may not exist yet. An existing entry confines like any
  // read — so a symlink is judged by where it points, and a broken one is
  // rejected outright rather than written through. A missing one confines the
  // nearest existing ancestor, then re-checks the full target so an escaping
  // or blocked suffix is rejected before anything touches disk. Returns the
  // real target path and whether an entry already exists there.
  const confineTarget = (userPath: string): { real: string; exists: boolean } => {
    const dirs = sandboxDirs();
    const absolute = absolutize(dirs, userPath);
    // lstat so a symlink counts as an existing entry even when its target is
    // missing — the ancestor walk below must never legitimise one.
    let entryExists = true;
    try {
      lstatSync(absolute);
    } catch {
      entryExists = false;
    }
    if (entryExists) {
      return { real: confine(absolute), exists: true };
    }
    // normalize collapses "." and ".." so the walk judges the path's true
    // location; the missing suffix can hold no symlinks yet.
    const target = normalize(absolute);
    let ancestor = dirname(target);
    while (!existsSync(ancestor)) {
      ancestor = dirname(ancestor);
    }
    const real = join(realpathSync(ancestor), relative(ancestor, target));
    requireWithin(dirs, userPath, real);
    return { real, exists: false };
  };

  const confineDir = (userPath: string): string => {
    const real = confine(userPath);
    if (!statSync(real).isDirectory()) {
      throw new Error(`"${userPath}" is not a directory — pass a file path to read_file instead.`);
    }
    return real;
  };

  // Broad access is explicit; a missing or stale cwd must never widen scope.
  const searchRoots = (directory: string | undefined, allAllowed: boolean): string[] => {
    if (directory !== undefined && allAllowed) {
      throw new Error("Choose directory or all_allowed, not both.");
    }
    if (directory !== undefined) return [confineDir(directory)];
    if (allAllowed) return sandboxDirs().map(confineDir).sort();
    const current = cwd.get();
    if (current === null) {
      throw new Error(
        "The session has no working directory — pass directory, set_working_directory, or explicitly use all_allowed.",
      );
    }
    return [confineDir(current)];
  };

  // Walk `root` collecting real absolute file paths whose root-relative form
  // matches `pattern`, sorted for determinism. The walk is asynchronous —
  // one await per directory and per matched file — so however big the tree,
  // the event loop keeps breathing; a synchronous walk here blocks the whole
  // server (every session, the UI, even signal handling) for the walk's
  // duration. Blocked names prune whole subtrees at the directory, never
  // descended into, and PRUNED_DIR_NAMES prune the same way unless the call
  // names one. Every entry seen is paid for from `budget`, shared
  // across the call's roots; when it runs out the walk stops and reports
  // itself capped so the caller can tell the model to narrow.
  const visibleMatches = async (
    root: string,
    pattern: string,
    dirs: string[],
    budget: { remaining: number },
  ): Promise<{ files: string[]; capped: boolean }> => {
    const rootSegments = new Set(root.split(sep));
    const isPruned = (name: string): boolean =>
      PRUNED_DIR_NAMES.has(name) && !pattern.includes(name) && !rootSegments.has(name);
    const glob = new Bun.Glob(pattern);
    const files: string[] = [];
    const stack: string[] = [root];
    for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        // Skipped: a directory deleted or unreadable mid-walk.
        continue;
      }
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        if (budget.remaining === 0) {
          return { files: files.sort(), capped: true };
        }
        budget.remaining -= 1;
        if (isBlockedName(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!isPruned(entry.name)) stack.push(path);
          continue;
        }
        // Anything that isn't a plain file — symlinks included, valid or
        // broken — is skipped outright: a link inside the sandbox can point
        // anywhere, so nothing is matched or read through one.
        if (!entry.isFile()) continue;
        if (!glob.match(relative(root, path))) continue;
        // The walk never descends a symlinked directory, so this resolves to
        // the path itself today — kept as defence in depth so a change in the
        // walk's symlink posture can't quietly leak a path out of the sandbox.
        const real = await realpath(path);
        if (within(dirs, real) === undefined || isBlockedWithin(root, real)) continue;
        files.push(real);
      }
    }
    return { files: files.sort(), capped: false };
  };

  return {
    find_files: tool({
      description:
        'Find files by name in the directories kiri may access: give a glob pattern (e.g. "**/*.md", "*.yaml") and get back the matching files\' absolute paths. Defaults to the working directory; pass directory for another allowed location or all_allowed for all roots. Page with limit/offset and next_offset; keep the query and scope unchanged. Hidden (dot-prefixed) files are included; .git internals and secret-bearing files (.env*, credential stores, the .kiri state directory) never are, and dependency, cache, and build-output directories (node_modules, dist, build, target, .venv, and kin) are skipped unless the pattern names them. Call it to discover what exists before read_file, or to check a path; a scan_limited result is incomplete even after paging — narrow directory or pattern to inspect beyond the scan budget.',
      inputSchema: z.object({
        pattern: z
          .string()
          .min(1)
          .describe('Glob pattern matched against file paths, e.g. "**/*.ts" or "docs/*.md".'),
        directory: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Directory to search under — absolute or relative to cwd. Omit for cwd; all_allowed explicitly searches every allowed root.",
          ),
        all_allowed: z
          .boolean()
          .optional()
          .describe("Search all allowed roots instead of cwd; cannot be combined with directory."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(maxFindResults)
          .optional()
          .describe(`Maximum returned files; default ${maxFindResults}.`),
        offset: pageOffset,
      }),
      execute: async ({
        pattern,
        directory,
        all_allowed = false,
        limit = maxFindResults,
        offset = 0,
      }) => {
        const dirs = sandboxDirs();
        const files = new Set<string>();
        const budget = { remaining: maxScannedEntries };
        let capped = false;
        for (const root of searchRoots(directory, all_allowed)) {
          const walk = await visibleMatches(root, pattern, dirs, budget);
          for (const real of walk.files) {
            files.add(real);
          }
          capped ||= walk.capped;
        }
        const sorted = [...files].sort();
        const notes: string[] = [];
        const shown = sorted.slice(offset, offset + limit);
        const nextOffset = offset + shown.length < sorted.length ? offset + shown.length : null;
        if (nextOffset !== null) {
          notes.push(
            `showing ${shown.length} of ${sorted.length} matches — continue with offset ${nextOffset}`,
          );
        }
        if (capped) {
          notes.push(
            `stopped after scanning ${maxScannedEntries} entries — narrow with directory or a tighter pattern`,
          );
        }
        return {
          files: shown,
          next_offset: nextOffset,
          scan_limited: capped,
          ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
        };
      },
    }),

    list_directory: tool({
      description:
        'List a directory\'s immediate entries in the directories kiri may access, by absolute or working-directory-relative path; directories in the result end with "/". Use it to orient in an unfamiliar directory one level at a time — reach for find_files when you already know a name pattern, and search_files for contents. Hidden (dot-prefixed) entries are included; .git and secret-bearing entries (.env*, credential stores, the .kiri state directory) never are.',
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Path of the directory to list — absolute or relative to the working directory.",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(maxFindResults)
          .optional()
          .describe(`Maximum returned entries; default ${maxFindResults}.`),
        offset: pageOffset,
      }),
      execute: async ({ path, limit = maxFindResults, offset = 0 }) => {
        const real = confineDir(path);
        const dirs = sandboxDirs();
        const entries: string[] = [];
        for (const entry of readdirSync(real, { withFileTypes: true })) {
          if (isBlockedName(entry.name)) continue;
          let isDirectory: boolean;
          if (entry.isSymbolicLink()) {
            // A symlinked entry is shown only when it resolves inside the
            // sandbox, with the kind of what it points at; a broken one has
            // nothing to show.
            let resolved: string;
            try {
              resolved = realpathSync(join(real, entry.name));
            } catch {
              continue;
            }
            const root = within(dirs, resolved);
            if (root === undefined || isBlockedWithin(root, resolved)) continue;
            isDirectory = statSync(resolved).isDirectory();
          } else {
            isDirectory = entry.isDirectory();
          }
          entries.push(isDirectory ? `${entry.name}/` : entry.name);
        }
        entries.sort();
        const shown = entries.slice(offset, offset + limit);
        const nextOffset = offset + shown.length < entries.length ? offset + shown.length : null;
        return {
          path: real,
          entries: shown,
          next_offset: nextOffset,
          ...(nextOffset !== null
            ? {
                note: `showing ${shown.length} of ${entries.length} entries — continue with offset ${nextOffset}`,
              }
            : {}),
        };
      },
    }),

    read_file: tool({
      description:
        "Read a text file from the directories kiri may access — by absolute path (exactly as find_files reports it) or one relative to the working directory. Binary files, .git internals, secret-bearing files (.env*, credential stores, the .kiri state directory), and paths outside the allowed directories are rejected. Use start_line and line_count for a focused range. Returned content preserves whitespace and line endings. A byte cap can split a long line: follow next (start_line/start_column) to continue, preserving line_count. Columns count Unicode code points, not bytes. Pages read live file contents, not a snapshot; partial_line flags an incomplete final line.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Path of the file to read — absolute (as find_files reports it) or relative to the working directory.",
          ),
        start_line: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe("First line, one-based; default 1."),
        line_count: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe(
            "Maximum lines to read; default 1000, at most 10000. The byte cap still applies.",
          ),
        start_column: z
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe(
            "One-based Unicode code-point column in start_line; default 1. Use next to resume a partial line.",
          ),
      }),
      execute: async ({ path, start_line = 1, line_count = 1000, start_column = 1 }) => {
        const real = confine(path);
        if (statSync(real).isDirectory()) {
          throw new Error(
            `"${path}" is a directory — call find_files to list what's inside it, then read a file.`,
          );
        }
        const content = await readFile(real);
        if (isBinary(content)) {
          throw new Error(
            `"${path}" is a binary file (${content.length} bytes) — the filesystem tools read text only.`,
          );
        }
        const lines = content.toString("utf8").match(/[^\n]*\n|[^\n]+$/g) ?? [];
        if (start_line > lines.length && start_column !== 1) {
          throw new Error("start_column requires an existing start_line.");
        }
        const selected = lines.slice(start_line - 1, start_line - 1 + line_count);
        if (selected.length > 0) {
          const first = Array.from(selected[0]);
          if (start_column > first.length) throw new Error("start_column exceeds the line length.");
          selected[0] = first.slice(start_column - 1).join("");
        }
        const bytes = Buffer.from(selected.join(""));
        const byteLimited = bytes.length > maxReadBytes;
        // Streaming decode omits an incomplete UTF-8 character at the cap;
        // it will be returned whole on the next page.
        const text = byteLimited
          ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, maxReadBytes), {
              stream: true,
            })
          : bytes.toString("utf8");
        if (byteLimited && text.length === 0)
          throw new Error("The read byte budget cannot fit one character.");
        const returnedLines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        const newlineCount = returnedLines.filter((line) => line.endsWith("\n")).length;
        const nextLine = start_line + newlineCount;
        const tail = returnedLines.at(-1) ?? "";
        const nextColumn = text.endsWith("\n")
          ? 1
          : (newlineCount === 0 ? start_column : 1) + Array.from(tail).length;
        const more = byteLimited || start_line - 1 + selected.length < lines.length;
        const next = more ? { start_line: nextLine, start_column: nextColumn } : null;
        const partialLine = byteLimited && !text.endsWith("\n");
        const endLine = text.length > 0 ? start_line + returnedLines.length - 1 : null;
        return {
          path: real,
          content: text,
          start_line,
          start_column,
          end_line: endLine,
          partial_line: partialLine,
          next,
          note: `Lines ${start_line}–${endLine ?? "none"}${start_column > 1 ? `, starting at column ${start_column}` : ""}.${
            next
              ? ` ${partialLine ? "Partial final line; " : ""}continue with start_line ${next.start_line}, start_column ${next.start_column}.`
              : " End of file."
          }`,
        };
      },
    }),

    search_files: tool({
      description:
        'Search file contents in the directories kiri may access: a regular expression (JavaScript syntax) matched against each line, returning the absolute file path, line number, and line text of every match. Prefer a tight scope: narrow with directory and an include glob (e.g. "**/*.yaml") rather than searching everything. Binary files, very large files, .git internals, and secret-bearing files (.env*, credential stores, the .kiri state directory) are skipped, along with dependency, cache, and build-output directories (node_modules, dist, build, target, .venv, and kin) unless the include glob names one or directory points inside one. Defaults to cwd; all_allowed explicitly searches all roots. context_lines adds bounded surrounding lines. Page with limit/offset and next_offset, preserving query and scope. scan_limited means the scan stopped: narrow directory/include to inspect beyond it. Long match/context lines are flagged truncated; read_file can retrieve their full text. Pages reflect live files.',
      inputSchema: z.object({
        pattern: z
          .string()
          .min(1)
          .describe("Regular expression (JavaScript syntax) matched against each line of text."),
        directory: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Directory to search under — absolute or relative to cwd. Omit for cwd; all_allowed explicitly searches every allowed root.",
          ),
        include: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Glob filter for which files to search, e.g. "*.md" or "src/**/*.ts". Defaults to every file.',
          ),
        all_allowed: z
          .boolean()
          .optional()
          .describe("Search all allowed roots instead of cwd; cannot be combined with directory."),
        context_lines: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Lines before and after each match; default 0, at most 10."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(maxSearchMatches)
          .optional()
          .describe(
            `Maximum matches; default ${maxSearchMatches}. A result byte budget also applies.`,
          ),
        offset: pageOffset,
      }),
      execute: async ({
        pattern,
        directory,
        include,
        all_allowed = false,
        context_lines = 0,
        limit = maxSearchMatches,
        offset = 0,
      }) => {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`Invalid regular expression: ${reason} — fix the pattern and retry.`);
        }
        const dirs = sandboxDirs();
        const files = new Set<string>();
        const budget = { remaining: maxScannedEntries };
        let capped = false;
        for (const root of searchRoots(directory, all_allowed)) {
          const walk = await visibleMatches(root, include ?? "**/*", dirs, budget);
          for (const file of walk.files) files.add(file);
          capped ||= walk.capped;
        }
        const matches: {
          file: string;
          line: number;
          text: string;
          truncated?: boolean;
          context?: { line: number; text: string; truncated?: boolean }[];
        }[] = [];
        let seen = 0;
        let more = false;
        let resultBytes = 0;
        let skippedLarge = 0;
        search: for (const real of [...files].sort()) {
          if ((await stat(real)).size > maxSearchFileBytes) {
            skippedLarge++;
            continue;
          }
          const content = await readFile(real);
          if (isBinary(content)) continue;
          const lines = content.toString("utf8").split(/\r?\n/);
          if (lines.at(-1) === "") lines.pop();
          for (let i = 0; i < lines.length; i++) {
            if (!regex.test(lines[i])) continue;
            if (seen++ < offset) continue;
            if (matches.length === limit) {
              more = true;
              break search;
            }
            const chars = Array.from(lines[i].trim());
            const match: (typeof matches)[number] = {
              file: real,
              line: i + 1,
              text: chars.slice(0, MAX_MATCH_TEXT).join(""),
              ...(chars.length > MAX_MATCH_TEXT ? { truncated: true } : {}),
            };
            if (context_lines > 0) {
              match.context = [];
              for (
                let j = Math.max(0, i - context_lines);
                j <= Math.min(lines.length - 1, i + context_lines);
                j++
              ) {
                if (j === i) continue;
                const contextChars = Array.from(lines[j]);
                match.context.push({
                  line: j + 1,
                  text: contextChars.slice(0, MAX_MATCH_TEXT).join(""),
                  ...(contextChars.length > MAX_MATCH_TEXT ? { truncated: true } : {}),
                });
              }
            }
            const size = Buffer.byteLength(JSON.stringify(match)) + 1;
            if (resultBytes + size > maxSearchResultBytes) {
              if (matches.length === 0)
                throw new Error(
                  "One match exceeds the result budget — reduce context_lines or narrow the search.",
                );
              more = true;
              break search;
            }
            matches.push(match);
            resultBytes += size;
          }
        }
        const nextOffset = more ? offset + matches.length : null;
        const notes: string[] = [];
        if (nextOffset !== null)
          notes.push(`stopped at ${matches.length} matches — continue with offset ${nextOffset}`);
        if (capped)
          notes.push(
            `stopped after scanning ${maxScannedEntries} entries — narrow with directory or an include filter`,
          );
        if (skippedLarge > 0)
          notes.push(
            `skipped ${skippedLarge} files over ${maxSearchFileBytes} bytes; use read_file for known paths`,
          );
        return {
          matches,
          next_offset: nextOffset,
          scan_limited: capped,
          ...(notes.length > 0 ? { note: notes.join("; ") } : {}),
        };
      },
    }),

    set_working_directory: tool({
      description:
        "Move the session's working directory — its current location within the directories kiri may access. Give an absolute path, or a path relative to the current working directory; it must name a directory that exists inside the allowed directories. Kiri refreshes the working directory and its applicable standing instructions before the next model step in this turn. Reach for this only when the root of the work itself changes (settling into a different project): everything beneath the current working directory is already reachable with relative paths, so never move just to step into a subdirectory.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "The directory to move to — absolute, or relative to the current working directory.",
          ),
      }),
      execute: async ({ path }) => {
        const real = confine(path);
        if (!statSync(real).isDirectory()) {
          throw new Error(`"${path}" is a file — the working directory must be a directory.`);
        }
        cwd.set(real);
        return { cwd: real };
      },
    }),

    write_file: tool({
      description:
        "Write a text file in the directories kiri may access, by absolute or working-directory-relative path — creating it (missing parent directories are created too) or overwriting it wholesale. Prefer edit_file for a targeted change to an existing file, and read_file first so an overwrite starts from the file's current contents. Binary files, .git internals, secret-bearing paths (.env*, credential stores, the .kiri state directory), and paths outside the allowed directories are rejected.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Path of the file to write — absolute or relative to the working directory."),
        content: z.string().describe("The full contents the file should hold."),
      }),
      execute: async ({ path, content }) => {
        const { real, exists } = confineTarget(path);
        options.checkInstructions?.(dirname(real));
        const next = withTrailingNewline(content);
        if (exists) {
          if (statSync(real).isDirectory()) {
            throw new Error(`"${path}" is a directory — pass the path of a file to write.`);
          }
          const before = readFileSync(real);
          if (isBinary(before)) {
            throw new Error(`"${path}" is a binary file — the filesystem tools write text only.`);
          }
          writeFileSync(real, next);
          // An overwrite's diff shows what the new content displaced; a
          // created file carries none — its content is already the call's
          // input, so the app renders that directly.
          return { path: real, created: false, ...unifiedDiff(before.toString("utf8"), next) };
        }
        mkdirSync(dirname(real), { recursive: true });
        writeFileSync(real, next);
        return { path: real, created: true };
      },
      toModelOutput: modelOutput,
    }),

    edit_file: tool({
      description:
        "Make a targeted edit to a text file in the directories kiri may access, by absolute or working-directory-relative path: old_string is replaced with new_string. old_string must match the file's current contents exactly — copy it verbatim from read_file output, whitespace included — and match exactly once; when it appears several times, include more surrounding context to pin down one occurrence, or set replace_all to change every one.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Path of the file to edit — absolute or relative to the working directory."),
        old_string: z.string().min(1).describe("Exact text to replace, as it appears in the file."),
        new_string: z.string().describe("Replacement text. Empty deletes old_string."),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of requiring exactly one match."),
      }),
      execute: async ({ path, old_string, new_string, replace_all }) => {
        if (old_string === new_string) {
          throw new Error("old_string and new_string are identical — nothing to change.");
        }
        const real = confine(path);
        if (statSync(real).isDirectory()) {
          throw new Error(`"${path}" is a directory — pass the path of a file to edit.`);
        }
        const content = readFileSync(real);
        if (isBinary(content)) {
          throw new Error(`"${path}" is a binary file — the filesystem tools edit text only.`);
        }
        const raw = content.toString("utf8");
        const count = raw.split(old_string).length - 1;
        if (count === 0) {
          throw new Error(
            `old_string was not found in "${path}" — call read_file and retry with the exact current text.`,
          );
        }
        if (count > 1 && replace_all !== true) {
          throw new Error(
            `old_string appears ${count} times in "${path}" — include more surrounding context to pin down one occurrence, or set replace_all to change every one.`,
          );
        }
        const next = raw.replaceAll(old_string, new_string);
        options.checkInstructions?.(dirname(real));
        writeFileSync(real, next);
        return { path: real, replacements: count, ...unifiedDiff(raw, next) };
      },
      toModelOutput: modelOutput,
    }),

    create_directory: tool({
      description:
        "Create a directory (and any missing parents) in the directories kiri may access, by absolute or working-directory-relative path. Creating a directory that already exists succeeds without changing anything. write_file creates its parent directories itself, so reach for this only when an empty directory is wanted on its own.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Path of the directory to create — absolute or relative to the working directory.",
          ),
      }),
      execute: async ({ path }) => {
        const { real, exists } = confineTarget(path);
        if (exists) {
          if (!statSync(real).isDirectory()) {
            throw new Error(`"${path}" is a file — pass the path of a directory to create.`);
          }
          return { path: real, created: false };
        }
        options.checkInstructions?.(real);
        mkdirSync(real, { recursive: true });
        return { path: real, created: true };
      },
    }),

    delete_file: tool({
      description:
        "Delete one file in the directories kiri may access, by absolute or working-directory-relative path. Directories go through delete_directory instead. Deletion is permanent — there is no undo.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Path of the file to delete — absolute or relative to the working directory."),
      }),
      execute: async ({ path }) => {
        const real = confine(path);
        if (statSync(real).isDirectory()) {
          throw new Error(`"${path}" is a directory — call delete_directory instead.`);
        }
        options.checkInstructions?.(dirname(real));
        unlinkSync(real);
        return { path: real, deleted: true };
      },
    }),

    delete_directory: tool({
      description:
        "Delete a directory in the directories kiri may access, by absolute or working-directory-relative path. An empty directory is removed outright; deleting one with contents requires recursive, which removes everything inside it — including .git internals and secret-bearing files the other filesystem tools never touch. Deletion is permanent — there is no undo.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Path of the directory to delete — absolute or relative to the working directory.",
          ),
        recursive: z
          .boolean()
          .optional()
          .describe("Also delete everything inside a non-empty directory."),
      }),
      execute: async ({ path, recursive }) => {
        const real = confine(path);
        if (!statSync(real).isDirectory()) {
          throw new Error(`"${path}" is a file — call delete_file instead.`);
        }
        if (sandboxDirs().includes(real)) {
          throw new Error(
            `"${path}" is one of the allowed directories themselves — delete things inside it, never the root.`,
          );
        }
        if (readdirSync(real).length > 0 && recursive !== true) {
          throw new Error(
            `"${path}" is not empty — set recursive to delete it and everything inside.`,
          );
        }
        options.checkInstructions?.(real, recursive === true);
        rmSync(real, { recursive: true });
        return { path: real, deleted: true };
      },
    }),
  };
}
