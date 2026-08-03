import {
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
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { type JSONValue, type ToolSet, tool } from "ai";
import { structuredPatch } from "diff";
import { z } from "zod";
import { compactWriteOutput } from "./write-tool-diffs.ts";

// Byte cap on a returned file body — the same budget as an MCP tool result, so
// one huge file can't blow the model's context. Larger files return their head
// with a note.
const MAX_READ_BYTES = 128 * 1024;

// Caps on match-set sizes. Past them the result is cut with a note telling the
// model to narrow its pattern — the full set would cost tokens without adding
// signal.
const MAX_FIND_RESULTS = 1_000;
const MAX_SEARCH_MATCHES = 200;

// Files larger than this are skipped by content search rather than read into
// memory; a lockfile or generated blob is noise at match time anyway.
const MAX_SEARCH_FILE_BYTES = 4 * 1024 * 1024;

// Cap on a single reported match line, so one minified line can't dominate the
// result.
const MAX_MATCH_TEXT = 500;

// Cap on the unified diff a write result carries. The diff feeds the app's
// transcript rendering — never the model — but it is persisted per message,
// so a pathological rewrite mustn't bloat the session store.
const MAX_DIFF_LENGTH = 64 * 1024;

// Non-fatal so a multi-byte character split at the byte cap is dropped rather
// than decoded to an invalid fragment.
const decoder = new TextDecoder("utf-8", { fatal: false });

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface FilesystemToolsOptions {
  maxReadBytes?: number;
  maxFindResults?: number;
  maxSearchMatches?: number;
  maxSearchFileBytes?: number;
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
 * `delete_directory` — confined to the workspace's declared sandbox.
 * Paths are absolute in both directions: every
 * model-supplied path must be absolute (a relative one is rejected with the
 * allowed set named — nothing ever resolves against a working directory), and
 * results report real absolute paths, so a find_files result feeds straight
 * back into read_file. Every path is resolved to its real form (defeating
 * `../` traversal and symlink escapes) and must sit inside one of
 * `getAllowedDirectories()` — read live per call, so a `kiri.yaml` edit
 * applies on the next call. Hidden (dot-prefixed) paths are reachable like any
 * other, bar a narrow denylist that stays outside the tool surface entirely:
 * `.git` internals (thousands of object files that would drown every broad
 * find) and secret-bearing files (`.env*`, kiri's own MCP credential store) —
 * reads run on the sandbox's authority alone, with no per-call approval to
 * catch a secret entering the transcript. Results are
 * capped, with a note naming the recovery (narrow the pattern) when cut.
 * Expected failures throw with a message naming the call that recovers,
 * surfaced to the model as a tool error so the turn self-corrects.
 */
export function filesystemTools(
  getAllowedDirectories: () => readonly string[],
  options: FilesystemToolsOptions = {},
): ToolSet {
  const {
    maxReadBytes = MAX_READ_BYTES,
    maxFindResults = MAX_FIND_RESULTS,
    maxSearchMatches = MAX_SEARCH_MATCHES,
    maxSearchFileBytes = MAX_SEARCH_FILE_BYTES,
    maxDiffLength = MAX_DIFF_LENGTH,
  } = options;

  // A unified diff of a file change — hunk headers and +/-/context lines, no
  // file-name preamble — for the app's transcript to render. The model never
  // receives it: toModelOutput and the send-time history transform strip it
  // (see write-tool-diffs.ts). Cut at the cap on a line boundary and flagged,
  // so the renderer can say the diff is partial.
  const unifiedDiff = (before: string, after: string): { diff: string; diffTruncated?: true } => {
    const { hunks } = structuredPatch("", "", before, after);
    const text = hunks
      .map(
        (hunk) =>
          `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`,
      )
      .join("\n");
    if (text.length <= maxDiffLength) return { diff: text };
    const cut = text.slice(0, maxDiffLength);
    const lastLine = cut.lastIndexOf("\n");
    return { diff: lastLine > 0 ? cut.slice(0, lastLine) : cut, diffTruncated: true };
  };

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
  // paths are otherwise reachable: `.git` internals, and the files that hold
  // secrets — `.env*` and kiri's MCP credential store — because reads carry no
  // per-call approval to catch a secret entering the transcript.
  const isBlockedName = (name: string): boolean =>
    name === ".git" || name.startsWith(".env") || name === "mcp-credentials.json";

  // Whether `real` sits under a blocked segment inside `root`. Also true for
  // a path that escapes `root` (its relative form starts with ".."), which
  // callers treat the same way: not part of this root's visible tree.
  const isBlockedWithin = (root: string, real: string): boolean => {
    const segments = relative(root, real).split(sep);
    return segments[0] === ".." || segments.some(isBlockedName);
  };

  const describeSandbox = (dirs: string[]): string =>
    dirs.length === 0 ? "none are configured" : dirs.map((dir) => `"${dir}"`).join(", ");

  const requireAbsolute = (dirs: string[], userPath: string): void => {
    if (!isAbsolute(userPath)) {
      throw new Error(
        `Relative path "${userPath}" — use an absolute path; the directories kiri may access are ${describeSandbox(dirs)}.`,
      );
    }
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
        `"${userPath}" is off-limits — .git internals and secret-bearing files (.env*, mcp-credentials.json) are outside the filesystem tools' reach.`,
      );
    }
  };

  // Resolve a model-supplied path to its real absolute form and reject — as a
  // recoverable tool error — anything relative, outside the sandbox, or hidden
  // within it.
  const confine = (userPath: string): string => {
    const dirs = sandboxDirs();
    requireAbsolute(dirs, userPath);
    let real: string;
    try {
      real = realpathSync(userPath);
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
    requireAbsolute(dirs, userPath);
    // lstat so a symlink counts as an existing entry even when its target is
    // missing — the ancestor walk below must never legitimise one.
    let entryExists = true;
    try {
      lstatSync(userPath);
    } catch {
      entryExists = false;
    }
    if (entryExists) {
      return { real: confine(userPath), exists: true };
    }
    // normalize collapses "." and ".." so the walk judges the path's true
    // location; the missing suffix can hold no symlinks yet.
    const target = normalize(userPath);
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

  // The roots a find/search runs over: the confined `directory` when given,
  // otherwise every sandbox directory.
  const searchRoots = (directory: string | undefined): string[] =>
    directory === undefined ? sandboxDirs() : [confineDir(directory)];

  // Glob `pattern` under `root`, yielding real absolute paths that are visible
  // (not blocked, not symlinked out of the sandbox), sorted for determinism.
  const visibleMatches = (root: string, pattern: string, dirs: string[]): string[] => {
    const matches: string[] = [];
    const glob = new Bun.Glob(pattern);
    for (const path of glob.scanSync({
      cwd: root,
      absolute: true,
      dot: true,
      followSymlinks: false,
      onlyFiles: true,
    })) {
      // Checked on the scanned path first — cheap string work that spares a
      // realpath syscall per `.git` object file on a broad pattern.
      if (isBlockedWithin(root, path)) continue;
      // Scanning with followSymlinks off yields no symlinks at all (valid or
      // broken), so this resolves to the path itself today — kept as defence
      // in depth so a change in the scanner's symlink posture can't quietly
      // leak a path out of the sandbox.
      const real = realpathSync(path);
      if (within(dirs, real) === undefined || isBlockedWithin(root, real)) continue;
      matches.push(real);
    }
    return matches.sort();
  };

  return {
    find_files: tool({
      description:
        'Find files by name in the directories kiri may access: give a glob pattern (e.g. "**/*.md", "*.yaml") and get back the matching files\' absolute paths. Searches every allowed directory unless directory narrows it. Hidden (dot-prefixed) files are included; .git internals and secret-bearing files (.env*, credential stores) never are. Call it to discover what exists before read_file, or to check a path; a result that notes truncation means the pattern was too broad — narrow it.',
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
            "Absolute path of a directory to search under. Omit to search every allowed directory.",
          ),
      }),
      execute: async ({ pattern, directory }) => {
        const dirs = sandboxDirs();
        const files = new Set<string>();
        for (const root of searchRoots(directory)) {
          for (const real of visibleMatches(root, pattern, dirs)) {
            files.add(real);
          }
        }
        const sorted = [...files].sort();
        if (sorted.length > maxFindResults) {
          return {
            files: sorted.slice(0, maxFindResults),
            note: `showing ${maxFindResults} of ${sorted.length} matches — narrow the pattern`,
          };
        }
        return { files: sorted };
      },
    }),

    list_directory: tool({
      description:
        'List a directory\'s immediate entries in the directories kiri may access, by absolute path; directories in the result end with "/". Use it to orient in an unfamiliar directory one level at a time — reach for find_files when you already know a name pattern, and search_files for contents. Hidden (dot-prefixed) entries are included; .git and secret-bearing entries (.env*, credential stores) never are.',
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the directory to list."),
      }),
      execute: async ({ path }) => {
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
            if (within(dirs, resolved) === undefined) continue;
            isDirectory = statSync(resolved).isDirectory();
          } else {
            isDirectory = entry.isDirectory();
          }
          entries.push(isDirectory ? `${entry.name}/` : entry.name);
        }
        entries.sort();
        if (entries.length > maxFindResults) {
          return {
            path: real,
            entries: entries.slice(0, maxFindResults),
            note: `showing ${maxFindResults} of ${entries.length} entries`,
          };
        }
        return { path: real, entries };
      },
    }),

    read_file: tool({
      description:
        "Read a text file from the directories kiri may access, by absolute path — exactly as find_files reports it. Binary files, .git internals, secret-bearing files (.env*, credential stores), and paths outside the allowed directories are rejected. A file too large to return in full comes back truncated with a note — reach for search_files to pinpoint the relevant part of a big file instead of reading it whole.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe("Absolute path of the file to read, as find_files reports it."),
      }),
      execute: async ({ path }) => {
        const real = confine(path);
        if (statSync(real).isDirectory()) {
          throw new Error(
            `"${path}" is a directory — call find_files to list what's inside it, then read a file.`,
          );
        }
        const content = readFileSync(real);
        if (isBinary(content)) {
          throw new Error(
            `"${path}" is a binary file (${content.length} bytes) — the filesystem tools read text only.`,
          );
        }
        if (content.length > maxReadBytes) {
          return {
            path: real,
            content: decoder.decode(content.subarray(0, maxReadBytes)),
            note: `truncated — first ${maxReadBytes} bytes of ${content.length}; use search_files to locate specific content`,
          };
        }
        return { path: real, content: content.toString("utf8") };
      },
    }),

    search_files: tool({
      description:
        'Search file contents in the directories kiri may access: a regular expression (JavaScript syntax) matched against each line, returning the absolute file path, line number, and line text of every match. Prefer a tight scope: narrow with directory and an include glob (e.g. "**/*.yaml") rather than searching everything. Binary files, very large files, .git internals, and secret-bearing files (.env*, credential stores) are skipped. A result that notes truncation means the pattern was too broad — tighten it.',
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
            "Absolute path of a directory to search under. Omit to search every allowed directory.",
          ),
        include: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Glob filter for which files to search, e.g. "*.md" or "src/**/*.ts". Defaults to every file.',
          ),
      }),
      execute: async ({ pattern, directory, include }) => {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern);
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          throw new Error(`Invalid regular expression: ${reason} — fix the pattern and retry.`);
        }
        const dirs = sandboxDirs();
        const matches: { file: string; line: number; text: string }[] = [];
        let truncated = false;
        for (const root of searchRoots(directory)) {
          for (const real of visibleMatches(root, include ?? "**/*", dirs)) {
            if (statSync(real).size > maxSearchFileBytes) continue;
            const content = readFileSync(real);
            if (isBinary(content)) continue;
            const lines = content.toString("utf8").split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (!regex.test(lines[i])) continue;
              if (matches.length === maxSearchMatches) {
                truncated = true;
                break;
              }
              matches.push({
                file: real,
                line: i + 1,
                text: lines[i].trim().slice(0, MAX_MATCH_TEXT),
              });
            }
            if (truncated) break;
          }
          if (truncated) break;
        }
        if (truncated) {
          return {
            matches,
            note: `stopped at ${maxSearchMatches} matches — tighten the pattern or include filter`,
          };
        }
        return { matches };
      },
    }),

    write_file: tool({
      description:
        "Write a text file in the directories kiri may access, by absolute path — creating it (missing parent directories are created too) or overwriting it wholesale. Prefer edit_file for a targeted change to an existing file, and read_file first so an overwrite starts from the file's current contents. Binary files, .git internals, secret-bearing paths (.env*, credential stores), and paths outside the allowed directories are rejected.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the file to write."),
        content: z.string().describe("The full contents the file should hold."),
      }),
      execute: async ({ path, content }) => {
        const { real, exists } = confineTarget(path);
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
        "Make a targeted edit to a text file in the directories kiri may access, by absolute path: old_string is replaced with new_string. old_string must match the file's current contents exactly — copy it verbatim from read_file output, whitespace included — and match exactly once; when it appears several times, include more surrounding context to pin down one occurrence, or set replace_all to change every one.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the file to edit."),
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
        writeFileSync(real, next);
        return { path: real, replacements: count, ...unifiedDiff(raw, next) };
      },
      toModelOutput: modelOutput,
    }),

    create_directory: tool({
      description:
        "Create a directory (and any missing parents) in the directories kiri may access, by absolute path. Creating a directory that already exists succeeds without changing anything. write_file creates its parent directories itself, so reach for this only when an empty directory is wanted on its own.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the directory to create."),
      }),
      execute: async ({ path }) => {
        const { real, exists } = confineTarget(path);
        if (exists) {
          if (!statSync(real).isDirectory()) {
            throw new Error(`"${path}" is a file — pass the path of a directory to create.`);
          }
          return { path: real, created: false };
        }
        mkdirSync(real, { recursive: true });
        return { path: real, created: true };
      },
    }),

    delete_file: tool({
      description:
        "Delete one file in the directories kiri may access, by absolute path. Directories go through delete_directory instead. Deletion is permanent — there is no undo.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the file to delete."),
      }),
      execute: async ({ path }) => {
        const real = confine(path);
        if (statSync(real).isDirectory()) {
          throw new Error(`"${path}" is a directory — call delete_directory instead.`);
        }
        unlinkSync(real);
        return { path: real, deleted: true };
      },
    }),

    delete_directory: tool({
      description:
        "Delete a directory in the directories kiri may access, by absolute path. An empty directory is removed outright; deleting one with contents requires recursive, which removes everything inside it — including .git internals and secret-bearing files the other filesystem tools never touch. Deletion is permanent — there is no undo.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the directory to delete."),
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
        rmSync(real, { recursive: true });
        return { path: real, deleted: true };
      },
    }),
  };
}
