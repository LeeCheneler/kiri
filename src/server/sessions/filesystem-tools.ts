import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";

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

// Non-fatal so a multi-byte character split at the byte cap is dropped rather
// than decoded to an invalid fragment.
const decoder = new TextDecoder("utf-8", { fatal: false });

/** Tunable bounds, defaulting to the module constants. Tests pass tiny values. */
export interface FilesystemToolsOptions {
  maxReadBytes?: number;
  maxFindResults?: number;
  maxSearchMatches?: number;
  maxSearchFileBytes?: number;
}

// Whether a buffer looks like binary content: a NUL byte in its head. The
// heuristic git itself uses.
const isBinary = (content: Buffer): boolean => content.subarray(0, 8192).includes(0);

/**
 * First-party tools that let a session find, list, read, and search files —
 * `find_files`, `list_directory`, `read_file`, `search_files` — confined to
 * the workspace's declared sandbox. Paths are absolute in both directions: every
 * model-supplied path must be absolute (a relative one is rejected with the
 * allowed set named — nothing ever resolves against a working directory), and
 * results report real absolute paths, so a find_files result feeds straight
 * back into read_file. Every path is resolved to its real form (defeating
 * `../` traversal and symlink escapes) and must sit inside one of
 * `getAllowedDirectories()` — read live per call, so a `kiri.yaml` edit
 * applies on the next call. Hidden (dot-prefixed) paths within the sandbox are
 * outside the tool surface entirely: never listed, searched, or readable —
 * they hold secrets (`.env`, `.kiri/`) more often than not. Results are
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
  } = options;

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

  // Whether `real` sits under a dot-prefixed segment inside `root`. Also true
  // for a path that escapes `root` (its relative form starts with ".."), which
  // callers treat the same way: not part of this root's visible tree.
  const isHiddenWithin = (root: string, real: string): boolean =>
    relative(root, real)
      .split(sep)
      .some((segment) => segment.startsWith("."));

  const describeSandbox = (dirs: string[]): string =>
    dirs.length === 0 ? "none are configured" : dirs.map((dir) => `"${dir}"`).join(", ");

  // Resolve a model-supplied path to its real absolute form and reject — as a
  // recoverable tool error — anything relative, outside the sandbox, or hidden
  // within it.
  const confine = (userPath: string): string => {
    const dirs = sandboxDirs();
    if (!isAbsolute(userPath)) {
      throw new Error(
        `Relative path "${userPath}" — use an absolute path; the directories kiri may access are ${describeSandbox(dirs)}.`,
      );
    }
    let real: string;
    try {
      real = realpathSync(userPath);
    } catch {
      throw new Error(`No such path "${userPath}" — call find_files to see what exists.`);
    }
    const root = within(dirs, real);
    if (root === undefined) {
      throw new Error(
        `"${userPath}" is outside the directories the filesystem tools may access (${describeSandbox(dirs)}) — stay inside them.`,
      );
    }
    if (isHiddenWithin(root, real)) {
      throw new Error(
        `"${userPath}" is a hidden (dot-prefixed) path — hidden files are outside the filesystem tools' reach.`,
      );
    }
    return real;
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
  // (not hidden, not symlinked out of the sandbox), sorted for determinism.
  const visibleMatches = (root: string, pattern: string, dirs: string[]): string[] => {
    const matches: string[] = [];
    const glob = new Bun.Glob(pattern);
    for (const path of glob.scanSync({
      cwd: root,
      absolute: true,
      dot: false,
      followSymlinks: false,
      onlyFiles: true,
    })) {
      // Scanning with followSymlinks off yields no symlinks at all (valid or
      // broken), so this resolves to the path itself today — kept as defence
      // in depth so a change in the scanner's symlink posture can't quietly
      // leak a path out of the sandbox.
      const real = realpathSync(path);
      if (within(dirs, real) === undefined || isHiddenWithin(root, real)) continue;
      matches.push(real);
    }
    return matches.sort();
  };

  return {
    find_files: tool({
      description:
        'Find files by name in the directories kiri may access: give a glob pattern (e.g. "**/*.md", "*.yaml") and get back the matching files\' absolute paths. Searches every allowed directory unless directory narrows it. Hidden (dot-prefixed) files and directories are never included. Call it to discover what exists before read_file, or to check a path; a result that notes truncation means the pattern was too broad — narrow it.',
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
        'List a directory\'s immediate entries in the directories kiri may access, by absolute path; directories in the result end with "/". Use it to orient in an unfamiliar directory one level at a time — reach for find_files when you already know a name pattern, and search_files for contents. Hidden (dot-prefixed) entries are never included.',
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path of the directory to list."),
      }),
      execute: async ({ path }) => {
        const real = confineDir(path);
        const dirs = sandboxDirs();
        const entries: string[] = [];
        for (const entry of readdirSync(real, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
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
        "Read a text file from the directories kiri may access, by absolute path — exactly as find_files reports it. Binary files, hidden (dot-prefixed) paths, and paths outside the allowed directories are rejected. A file too large to return in full comes back truncated with a note — reach for search_files to pinpoint the relevant part of a big file instead of reading it whole.",
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
        'Search file contents in the directories kiri may access: a regular expression (JavaScript syntax) matched against each line, returning the absolute file path, line number, and line text of every match. Prefer a tight scope: narrow with directory and an include glob (e.g. "**/*.yaml") rather than searching everything. Binary files, very large files, and hidden (dot-prefixed) paths are skipped. A result that notes truncation means the pattern was too broad — tighten it.',
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
  };
}
