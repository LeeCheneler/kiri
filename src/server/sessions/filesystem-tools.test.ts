import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { type FilesystemToolsOptions, filesystemTools } from "./filesystem-tools.ts";

// Invoke a tool's execute with a minimal ToolExecutionOptions, casting away
// the union's `never` input so a test can call it plainly.
const run = (t: ToolSet[string], input: unknown): Promise<unknown> =>
  (t.execute as (input: unknown, options: ToolExecutionOptions) => Promise<unknown>)(input, {
    toolCallId: "call-1",
    messages: [],
  } as ToolExecutionOptions);

describe("filesystemTools", () => {
  let workspace: string;
  let outside: string;
  let cwdValue: string | null;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "kiri-fs-tools-"));
    outside = mkdtempSync(join(tmpdir(), "kiri-fs-outside-"));
    cwdValue = null;
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const tools = (allowed: string[] = [workspace], options: FilesystemToolsOptions = {}): ToolSet =>
    filesystemTools(
      () => allowed,
      {
        get: () => cwdValue,
        set: (dir) => {
          cwdValue = dir;
        },
      },
      options,
    );

  // Results report *real* absolute paths (macOS's tmpdir is symlinked), so
  // expectations build on the realpath'd roots.
  const ws = (...segments: string[]): string => join(realpathSync(workspace), ...segments);
  const out = (...segments: string[]): string => join(realpathSync(outside), ...segments);

  describe("find_files", () => {
    it("finds files by glob pattern, absolute and sorted", async () => {
      writeFileSync(join(workspace, "b.md"), "b");
      writeFileSync(join(workspace, "a.md"), "a");
      mkdirSync(join(workspace, "sub"));
      writeFileSync(join(workspace, "sub", "c.md"), "c");
      writeFileSync(join(workspace, "notes.txt"), "not matched");
      const result = await run(tools().find_files, { pattern: "**/*.md" });
      expect(result).toEqual({ files: [ws("a.md"), ws("b.md"), ws("sub", "c.md")] });
    });

    it("includes hidden files but never .git internals or secret-bearing files", async () => {
      writeFileSync(join(workspace, "visible.md"), "ok");
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      writeFileSync(join(workspace, ".env.local"), "SECRET=2");
      mkdirSync(join(workspace, ".kiri"));
      writeFileSync(join(workspace, ".kiri", "config.yaml"), "a: 1");
      writeFileSync(join(workspace, ".kiri", "mcp-credentials.json"), "{}");
      mkdirSync(join(workspace, ".git", "objects"), { recursive: true });
      writeFileSync(join(workspace, ".git", "objects", "ab12"), "blob");
      const result = await run(tools().find_files, { pattern: "**/*" });
      expect(result).toEqual({ files: [ws(".kiri", "config.yaml"), ws("visible.md")] });
    });

    it("searches under the given directory only", async () => {
      writeFileSync(join(workspace, "top.md"), "top");
      mkdirSync(join(workspace, "sub"));
      writeFileSync(join(workspace, "sub", "inner.md"), "inner");
      const result = await run(tools().find_files, {
        pattern: "*.md",
        directory: join(workspace, "sub"),
      });
      expect(result).toEqual({ files: [ws("sub", "inner.md")] });
    });

    it("searches every allowed directory when directory is omitted", async () => {
      writeFileSync(join(workspace, "here.md"), "here");
      writeFileSync(join(outside, "there.md"), "there");
      const result = await run(tools([workspace, outside]).find_files, { pattern: "**/*.md" });
      expect(result).toEqual({ files: [ws("here.md"), out("there.md")].sort() });
    });

    it("rejects a relative directory, telling the model to use absolute paths", async () => {
      expect(run(tools().find_files, { pattern: "*", directory: "sub" })).rejects.toThrow(
        /use an absolute path; the directories kiri may access are/,
      );
    });

    it("rejects a directory outside the sandbox, naming the allowed set", async () => {
      expect(run(tools().find_files, { pattern: "*", directory: outside })).rejects.toThrow(
        /outside the directories the filesystem tools may access/,
      );
    });

    it("rejects a directory that is actually a file", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(
        run(tools().find_files, { pattern: "*", directory: join(workspace, "a.md") }),
      ).rejects.toThrow(/not a directory/);
    });

    it("excludes a symlink that resolves outside the sandbox", async () => {
      writeFileSync(join(outside, "secret.md"), "leaked");
      symlinkSync(join(outside, "secret.md"), join(workspace, "leak.md"));
      writeFileSync(join(workspace, "safe.md"), "safe");
      const result = await run(tools().find_files, { pattern: "**/*.md" });
      expect(result).toEqual({ files: [ws("safe.md")] });
    });

    it("excludes a broken symlink", async () => {
      symlinkSync(join(workspace, "missing.md"), join(workspace, "broken.md"));
      const result = await run(tools().find_files, { pattern: "**/*.md" });
      expect(result).toEqual({ files: [] });
    });

    it("skips an allowed directory that doesn't exist", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      const result = await run(tools([join(workspace, "nope"), workspace]).find_files, {
        pattern: "**/*.md",
      });
      expect(result).toEqual({ files: [ws("a.md")] });
    });

    it("caps the result with a note telling the model to narrow", async () => {
      for (const name of ["a.md", "b.md", "c.md"]) {
        writeFileSync(join(workspace, name), name);
      }
      const result = (await run(tools([workspace], { maxFindResults: 2 }).find_files, {
        pattern: "**/*.md",
      })) as { files: string[]; note: string };
      expect(result.files).toEqual([ws("a.md"), ws("b.md")]);
      expect(result.note).toMatch(/showing 2 of 3 matches — narrow the pattern/);
    });

    it("skips dependency, cache, and build-output directories by default", async () => {
      for (const name of ["node_modules", "dist", "target", ".venv"]) {
        mkdirSync(join(workspace, name, "pkg"), { recursive: true });
        writeFileSync(join(workspace, name, "pkg", "readme.md"), "generated");
      }
      writeFileSync(join(workspace, "a.md"), "a");
      const result = await run(tools().find_files, { pattern: "**/*.md" });
      expect(result).toEqual({ files: [ws("a.md")] });
    });

    it("still finds a file named like a pruned directory", async () => {
      mkdirSync(join(workspace, "bin"));
      writeFileSync(join(workspace, "bin", "build"), "#!/bin/sh");
      const result = await run(tools().find_files, { pattern: "**/*" });
      expect(result).toEqual({ files: [ws("bin", "build")] });
    });

    it("descends into node_modules when the pattern names it", async () => {
      mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(workspace, "node_modules", "pkg", "readme.md"), "dep");
      const result = await run(tools().find_files, { pattern: "node_modules/**/*.md" });
      expect(result).toEqual({ files: [ws("node_modules", "pkg", "readme.md")] });
    });

    it("searches inside node_modules when directory points into one", async () => {
      mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(workspace, "node_modules", "pkg", "readme.md"), "dep");
      const result = await run(tools().find_files, {
        pattern: "**/*.md",
        directory: join(workspace, "node_modules", "pkg"),
      });
      expect(result).toEqual({ files: [ws("node_modules", "pkg", "readme.md")] });
    });

    it("stops at the scan budget with a note telling the model to narrow", async () => {
      for (const name of ["a.md", "b.md", "c.md", "d.md"]) {
        writeFileSync(join(workspace, name), name);
      }
      const result = (await run(tools([workspace], { maxScannedEntries: 2 }).find_files, {
        pattern: "**/*.md",
      })) as { files: string[]; note: string };
      expect(result.files).toHaveLength(2);
      expect(result.note).toMatch(/stopped after scanning 2 entries — narrow with directory/);
    });

    it("skips an unreadable directory rather than failing", async () => {
      mkdirSync(join(workspace, "locked"));
      writeFileSync(join(workspace, "locked", "hidden.md"), "h");
      writeFileSync(join(workspace, "a.md"), "a");
      chmodSync(join(workspace, "locked"), 0o000);
      try {
        const result = await run(tools().find_files, { pattern: "**/*.md" });
        expect(result).toEqual({ files: [ws("a.md")] });
      } finally {
        chmodSync(join(workspace, "locked"), 0o755);
      }
    });
  });

  describe("list_directory", () => {
    it("lists immediate entries with directories marked by a trailing slash", async () => {
      writeFileSync(join(workspace, "notes.md"), "n");
      mkdirSync(join(workspace, "docs"));
      writeFileSync(join(workspace, "docs", "nested.md"), "hidden from this level");
      const result = await run(tools().list_directory, { path: workspace });
      expect(result).toEqual({ path: ws(), entries: ["docs/", "notes.md"] });
    });

    it("lists hidden entries but never .git or secret-bearing ones", async () => {
      writeFileSync(join(workspace, "visible.md"), "ok");
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      mkdirSync(join(workspace, ".kiri"));
      mkdirSync(join(workspace, ".git"));
      const result = await run(tools().list_directory, { path: workspace });
      expect(result).toEqual({ path: ws(), entries: [".kiri/", "visible.md"] });
    });

    it("returns an empty listing for an empty directory", async () => {
      mkdirSync(join(workspace, "empty"));
      const result = await run(tools().list_directory, { path: join(workspace, "empty") });
      expect(result).toEqual({ path: ws("empty"), entries: [] });
    });

    it("shows a symlinked entry that stays inside the sandbox, with its target's kind", async () => {
      mkdirSync(join(workspace, "sub"));
      symlinkSync(join(workspace, "sub"), join(workspace, "sub-link"));
      const result = await run(tools().list_directory, { path: workspace });
      expect(result).toEqual({ path: ws(), entries: ["sub-link/", "sub/"] });
    });

    it("skips symlinked entries that resolve outside the sandbox, and broken ones", async () => {
      writeFileSync(join(outside, "secret.md"), "leaked");
      symlinkSync(join(outside, "secret.md"), join(workspace, "leak.md"));
      symlinkSync(join(workspace, "missing.md"), join(workspace, "broken.md"));
      writeFileSync(join(workspace, "safe.md"), "safe");
      const result = await run(tools().list_directory, { path: workspace });
      expect(result).toEqual({ path: ws(), entries: ["safe.md"] });
    });

    it("rejects a relative path", async () => {
      expect(run(tools().list_directory, { path: "sub" })).rejects.toThrow(/use an absolute path/);
    });

    it("rejects a path outside the sandbox", async () => {
      expect(run(tools().list_directory, { path: outside })).rejects.toThrow(
        /outside the directories/,
      );
    });

    it("rejects a file path", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(run(tools().list_directory, { path: join(workspace, "a.md") })).rejects.toThrow(
        /not a directory/,
      );
    });

    it("caps the listing with a note", async () => {
      for (const name of ["a.md", "b.md", "c.md"]) {
        writeFileSync(join(workspace, name), name);
      }
      const result = (await run(tools([workspace], { maxFindResults: 2 }).list_directory, {
        path: workspace,
      })) as { entries: string[]; note: string };
      expect(result.entries).toEqual(["a.md", "b.md"]);
      expect(result.note).toMatch(/showing 2 of 3 entries/);
    });
  });

  describe("read_file", () => {
    it("reads a file by absolute path, reporting its real path", async () => {
      mkdirSync(join(workspace, "docs"));
      writeFileSync(join(workspace, "docs", "guide.md"), "# Guide\n");
      const result = await run(tools().read_file, { path: join(workspace, "docs", "guide.md") });
      expect(result).toEqual({ path: ws("docs", "guide.md"), content: "# Guide\n" });
    });

    it("reads from a second allowed directory", async () => {
      writeFileSync(join(outside, "notes.md"), "external");
      const result = await run(tools([workspace, outside]).read_file, {
        path: join(outside, "notes.md"),
      });
      expect(result).toEqual({ path: out("notes.md"), content: "external" });
    });

    it("rejects a relative path, naming the allowed directories", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(run(tools().read_file, { path: "a.md" })).rejects.toThrow(
        /use an absolute path; the directories kiri may access are/,
      );
    });

    it("rejects ../ traversal out of the sandbox", async () => {
      writeFileSync(join(outside, "secret.md"), "no");
      expect(
        run(tools().read_file, { path: join(workspace, "..", basename(outside), "secret.md") }),
      ).rejects.toThrow(/outside the directories/);
      expect(run(tools().read_file, { path: join(outside, "secret.md") })).rejects.toThrow(
        /outside the directories/,
      );
    });

    it("rejects a symlink that resolves outside the sandbox", async () => {
      writeFileSync(join(outside, "secret.md"), "no");
      symlinkSync(join(outside, "secret.md"), join(workspace, "leak.md"));
      expect(run(tools().read_file, { path: join(workspace, "leak.md") })).rejects.toThrow(
        /outside the directories/,
      );
    });

    it("reads hidden files but rejects .git internals and secret-bearing ones", async () => {
      mkdirSync(join(workspace, ".kiri"));
      writeFileSync(join(workspace, ".kiri", "config.yaml"), "a: 1\n");
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      writeFileSync(join(workspace, ".kiri", "mcp-credentials.json"), "{}");
      mkdirSync(join(workspace, ".git"));
      writeFileSync(join(workspace, ".git", "config"), "[core]\n");
      const result = await run(tools().read_file, {
        path: join(workspace, ".kiri", "config.yaml"),
      });
      expect(result).toEqual({ path: ws(".kiri", "config.yaml"), content: "a: 1\n" });
      expect(run(tools().read_file, { path: join(workspace, ".env") })).rejects.toThrow(
        /off-limits/,
      );
      expect(
        run(tools().read_file, { path: join(workspace, ".kiri", "mcp-credentials.json") }),
      ).rejects.toThrow(/off-limits/);
      expect(run(tools().read_file, { path: join(workspace, ".git", "config") })).rejects.toThrow(
        /off-limits/,
      );
    });

    it("rejects a missing file, naming find_files as the recovery", async () => {
      expect(run(tools().read_file, { path: join(workspace, "gone.md") })).rejects.toThrow(
        /call find_files/,
      );
    });

    it("rejects a directory path", async () => {
      mkdirSync(join(workspace, "sub"));
      expect(run(tools().read_file, { path: join(workspace, "sub") })).rejects.toThrow(
        /is a directory/,
      );
    });

    it("rejects a binary file", async () => {
      writeFileSync(join(workspace, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
      expect(run(tools().read_file, { path: join(workspace, "blob.bin") })).rejects.toThrow(
        /binary file/,
      );
    });

    it("truncates a file over the byte cap with a note", async () => {
      writeFileSync(join(workspace, "big.md"), "hello world!");
      const result = (await run(tools([workspace], { maxReadBytes: 8 }).read_file, {
        path: join(workspace, "big.md"),
      })) as { content: string; note: string };
      expect(result.content).toBe("hello wo");
      expect(result.note).toMatch(/truncated — first 8 bytes of 12/);
    });

    it("reports an empty sandbox when no directories are configured", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(run(tools([]).read_file, { path: join(workspace, "a.md") })).rejects.toThrow(
        /none are configured/,
      );
    });
  });

  describe("search_files", () => {
    it("returns file, line number, and trimmed line text for each match", async () => {
      writeFileSync(join(workspace, "a.md"), "first\n  TODO: fix this  \nlast\n");
      mkdirSync(join(workspace, "sub"));
      writeFileSync(join(workspace, "sub", "b.md"), "TODO: another\n");
      const result = await run(tools().search_files, { pattern: "TODO" });
      expect(result).toEqual({
        matches: [
          { file: ws("a.md"), line: 2, text: "TODO: fix this" },
          { file: ws("sub", "b.md"), line: 1, text: "TODO: another" },
        ],
      });
    });

    it("filters searched files with an include glob", async () => {
      writeFileSync(join(workspace, "a.md"), "TODO in md\n");
      writeFileSync(join(workspace, "a.txt"), "TODO in txt\n");
      const result = (await run(tools().search_files, {
        pattern: "TODO",
        include: "**/*.txt",
      })) as { matches: { file: string }[] };
      expect(result.matches.map((m) => m.file)).toEqual([ws("a.txt")]);
    });

    it("searches under the given directory only", async () => {
      writeFileSync(join(workspace, "top.md"), "TODO top\n");
      mkdirSync(join(workspace, "sub"));
      writeFileSync(join(workspace, "sub", "inner.md"), "TODO inner\n");
      const result = (await run(tools().search_files, {
        pattern: "TODO",
        directory: join(workspace, "sub"),
      })) as { matches: { file: string }[] };
      expect(result.matches.map((m) => m.file)).toEqual([ws("sub", "inner.md")]);
    });

    it("rejects an invalid regular expression with the reason", async () => {
      expect(run(tools().search_files, { pattern: "(" })).rejects.toThrow(
        /Invalid regular expression/,
      );
    });

    it("stops at the match cap with a note telling the model to tighten", async () => {
      writeFileSync(join(workspace, "a.md"), "hit\nhit\nhit\n");
      const result = (await run(tools([workspace], { maxSearchMatches: 2 }).search_files, {
        pattern: "hit",
      })) as { matches: unknown[]; note: string };
      expect(result.matches).toHaveLength(2);
      expect(result.note).toMatch(/stopped at 2 matches/);
    });

    it("skips binary files", async () => {
      writeFileSync(join(workspace, "blob.bin"), Buffer.from("hit\x00hit"));
      writeFileSync(join(workspace, "a.md"), "hit\n");
      const result = (await run(tools().search_files, { pattern: "hit" })) as {
        matches: { file: string }[];
      };
      expect(result.matches.map((m) => m.file)).toEqual([ws("a.md")]);
    });

    it("skips files over the searchable-size cap", async () => {
      writeFileSync(join(workspace, "huge.md"), "hit hit hit hit\n");
      writeFileSync(join(workspace, "a.md"), "hit\n");
      const result = (await run(tools([workspace], { maxSearchFileBytes: 8 }).search_files, {
        pattern: "hit",
      })) as { matches: { file: string }[] };
      expect(result.matches.map((m) => m.file)).toEqual([ws("a.md")]);
    });

    it("searches hidden files but never secret-bearing ones", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=hit\n");
      mkdirSync(join(workspace, ".kiri"));
      writeFileSync(join(workspace, ".kiri", "config.yaml"), "hit\n");
      const result = await run(tools().search_files, { pattern: "hit" });
      expect(result).toEqual({
        matches: [{ file: ws(".kiri", "config.yaml"), line: 1, text: "hit" }],
      });
    });

    it("returns an empty match list when nothing matches", async () => {
      writeFileSync(join(workspace, "a.md"), "quiet\n");
      const result = await run(tools().search_files, { pattern: "absent" });
      expect(result).toEqual({ matches: [] });
    });

    it("skips dependency, cache, and build-output directories by default", async () => {
      for (const name of ["node_modules", "dist", "target", ".venv"]) {
        mkdirSync(join(workspace, name, "pkg"), { recursive: true });
        writeFileSync(join(workspace, name, "pkg", "index.js"), "hit\n");
      }
      writeFileSync(join(workspace, "a.md"), "hit\n");
      const result = (await run(tools().search_files, { pattern: "hit" })) as {
        matches: { file: string }[];
      };
      expect(result.matches.map((m) => m.file)).toEqual([ws("a.md")]);
    });

    it("searches node_modules when the include names it", async () => {
      mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(workspace, "node_modules", "pkg", "index.js"), "hit\n");
      writeFileSync(join(workspace, "a.md"), "hit\n");
      const result = (await run(tools().search_files, {
        pattern: "hit",
        include: "node_modules/**",
      })) as { matches: { file: string }[] };
      expect(result.matches.map((m) => m.file)).toEqual([ws("node_modules", "pkg", "index.js")]);
    });

    it("stops at the scan budget with a note telling the model to narrow", async () => {
      for (const name of ["a.md", "b.md", "c.md", "d.md"]) {
        writeFileSync(join(workspace, name), "hit\n");
      }
      const result = (await run(tools([workspace], { maxScannedEntries: 2 }).search_files, {
        pattern: "hit",
      })) as { matches: unknown[]; note: string };
      expect(result.matches).toHaveLength(2);
      expect(result.note).toMatch(/stopped after scanning 2 entries — narrow with directory/);
    });
  });

  describe("set_working_directory", () => {
    it("moves to an absolute directory inside the sandbox and persists it", async () => {
      mkdirSync(join(workspace, "sub"));
      const result = await run(tools().set_working_directory, { path: join(workspace, "sub") });
      expect(result).toEqual({ cwd: ws("sub") });
      expect(cwdValue).toBe(ws("sub"));
    });

    it("resolves a relative path against the current working directory", async () => {
      mkdirSync(join(workspace, "a", "b"), { recursive: true });
      cwdValue = ws("a");
      expect(await run(tools().set_working_directory, { path: "b" })).toEqual({
        cwd: ws("a", "b"),
      });
      expect(await run(tools().set_working_directory, { path: ".." })).toEqual({ cwd: ws("a") });
    });

    it("rejects a relative path when the session has no working directory", async () => {
      mkdirSync(join(workspace, "sub"));
      expect(run(tools().set_working_directory, { path: "sub" })).rejects.toThrow(
        /use an absolute path/,
      );
      expect(cwdValue).toBeNull();
    });

    it("rejects a directory outside the sandbox, including one reached via ..", async () => {
      expect(run(tools().set_working_directory, { path: outside })).rejects.toThrow(/outside/);
      cwdValue = ws();
      expect(run(tools().set_working_directory, { path: ".." })).rejects.toThrow(/outside/);
      expect(cwdValue).toBe(ws());
    });

    it("rejects a symlink that points out of the sandbox", async () => {
      symlinkSync(outside, join(workspace, "escape"));
      expect(
        run(tools().set_working_directory, { path: join(workspace, "escape") }),
      ).rejects.toThrow(/outside/);
    });

    it("rejects files, missing paths, and blocked directories", async () => {
      writeFileSync(join(workspace, "notes.md"), "hi");
      expect(
        run(tools().set_working_directory, { path: join(workspace, "notes.md") }),
      ).rejects.toThrow(/must be a directory/);
      expect(run(tools().set_working_directory, { path: join(workspace, "gone") })).rejects.toThrow(
        /No such path/,
      );
      mkdirSync(join(workspace, ".git", "objects"), { recursive: true });
      expect(
        run(tools().set_working_directory, { path: join(workspace, ".git", "objects") }),
      ).rejects.toThrow(/off-limits/);
      expect(cwdValue).toBeNull();
    });
  });

  describe("working-directory-relative paths", () => {
    it("resolves reads and searches against the working directory", async () => {
      mkdirSync(join(workspace, "docs"));
      writeFileSync(join(workspace, "docs", "notes.md"), "remember\n");
      cwdValue = ws("docs");
      expect(await run(tools().read_file, { path: "notes.md" })).toEqual({
        path: ws("docs", "notes.md"),
        content: "remember\n",
      });
      expect(await run(tools().find_files, { pattern: "*.md", directory: "." })).toEqual({
        files: [ws("docs", "notes.md")],
      });
      expect(await run(tools().list_directory, { path: "." })).toEqual({
        path: ws("docs"),
        entries: ["notes.md"],
      });
    });

    it("resolves a write target that doesn't exist yet against the working directory", async () => {
      cwdValue = ws();
      const result = await run(tools().write_file, { path: "new/draft.md", content: "hi" });
      expect(result).toEqual({ path: ws("new", "draft.md"), created: true });
      expect(readFileSync(join(workspace, "new", "draft.md"), "utf8")).toBe("hi\n");
    });

    it("rejects a relative path that escapes the sandbox or lands somewhere blocked", async () => {
      cwdValue = ws();
      expect(run(tools().read_file, { path: join("..", basename(outside)) })).rejects.toThrow(
        /outside the directories/,
      );
      mkdirSync(join(workspace, ".git"));
      writeFileSync(join(workspace, ".git", "config"), "[core]");
      expect(run(tools().read_file, { path: ".git/config" })).rejects.toThrow(/off-limits/);
      expect(run(tools().write_file, { path: "../escape.md", content: "x" })).rejects.toThrow(
        /outside the directories/,
      );
    });

    it("rejects every relative path when the session has no working directory", async () => {
      writeFileSync(join(workspace, "notes.md"), "hi");
      expect(run(tools().read_file, { path: "notes.md" })).rejects.toThrow(/use an absolute path/);
      expect(run(tools().write_file, { path: "new.md", content: "x" })).rejects.toThrow(
        /use an absolute path/,
      );
    });
  });

  describe("write_file", () => {
    it("creates a new file, adding the missing trailing newline", async () => {
      const result = await run(tools().write_file, {
        path: join(workspace, "notes.md"),
        content: "# Notes",
      });
      expect(result).toEqual({ path: ws("notes.md"), created: true });
      expect(readFileSync(join(workspace, "notes.md"), "utf8")).toBe("# Notes\n");
    });

    it("creates missing parent directories", async () => {
      const result = await run(tools().write_file, {
        path: join(workspace, "docs", "deep", "guide.md"),
        content: "guide\n",
      });
      expect(result).toEqual({ path: ws("docs", "deep", "guide.md"), created: true });
      expect(readFileSync(join(workspace, "docs", "deep", "guide.md"), "utf8")).toBe("guide\n");
    });

    it("overwrites an existing file, reporting the change as a unified diff", async () => {
      writeFileSync(join(workspace, "notes.md"), "old\n");
      const result = await run(tools().write_file, {
        path: join(workspace, "notes.md"),
        content: "new\n",
      });
      expect(result).toEqual({
        path: ws("notes.md"),
        created: false,
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      });
      expect(readFileSync(join(workspace, "notes.md"), "utf8")).toBe("new\n");
    });

    it("carries no diff when creating — the content is already the call's input", async () => {
      const result = (await run(tools().write_file, {
        path: join(workspace, "fresh.md"),
        content: "hello\n",
      })) as Record<string, unknown>;
      expect(result.created).toBe(true);
      expect("diff" in result).toBe(false);
    });

    it("truncates an oversized diff on a line boundary and flags it", async () => {
      writeFileSync(join(workspace, "a.md"), "one\ntwo\nthree\n");
      const result = (await run(tools([workspace], { maxDiffLength: 25 }).write_file, {
        path: join(workspace, "a.md"),
        content: "uno\ndos\ntres\n",
      })) as { diff: string; diffTruncated?: true };
      expect(result.diffTruncated).toBe(true);
      expect(result.diff.length).toBeLessThanOrEqual(25);
      expect(result.diff.endsWith("\n")).toBe(false);

      // A cap tighter than the first line still yields a flagged fragment.
      writeFileSync(join(workspace, "b.md"), "one\n");
      const tiny = (await run(tools([workspace], { maxDiffLength: 4 }).write_file, {
        path: join(workspace, "b.md"),
        content: "uno\n",
      })) as { diff: string; diffTruncated?: true };
      expect(tiny.diffTruncated).toBe(true);
      expect(tiny.diff).toBe("@@ -");
    });

    it("strips the diff from what the model receives via toModelOutput", async () => {
      const output = { path: "/ws/a.md", created: false, diff: "-a\n+b", diffTruncated: true };
      const result = await tools().write_file.toModelOutput?.({
        toolCallId: "call-1",
        input: { path: "/ws/a.md", content: "b\n" },
        output,
      });
      expect(result).toEqual({
        type: "json",
        value: { path: "/ws/a.md", created: false },
      });
      // The persisted output object itself is untouched.
      expect(output.diff).toBe("-a\n+b");
    });

    it("writes empty content as an empty file", async () => {
      await run(tools().write_file, { path: join(workspace, "empty.md"), content: "" });
      expect(readFileSync(join(workspace, "empty.md"), "utf8")).toBe("");
    });

    it("rejects a relative path", async () => {
      expect(run(tools().write_file, { path: "notes.md", content: "x" })).rejects.toThrow(
        /use an absolute path/,
      );
    });

    it("rejects ../ traversal out of the sandbox without touching disk", async () => {
      const escapePath = join(workspace, "..", basename(outside), "new.md");
      expect(run(tools().write_file, { path: escapePath, content: "x" })).rejects.toThrow(
        /outside the directories/,
      );
      expect(existsSync(join(outside, "new.md"))).toBe(false);
    });

    it("rejects a new path under a symlinked directory that resolves outside", async () => {
      symlinkSync(outside, join(workspace, "linked"));
      expect(
        run(tools().write_file, { path: join(workspace, "linked", "new.md"), content: "x" }),
      ).rejects.toThrow(/outside the directories/);
      expect(existsSync(join(outside, "new.md"))).toBe(false);
    });

    it("rejects writing through a symlink whose target is outside", async () => {
      writeFileSync(join(outside, "target.md"), "keep\n");
      symlinkSync(join(outside, "target.md"), join(workspace, "leak.md"));
      expect(
        run(tools().write_file, { path: join(workspace, "leak.md"), content: "x" }),
      ).rejects.toThrow(/outside the directories/);
      expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("keep\n");
    });

    it("rejects writing through a broken symlink rather than creating its target", async () => {
      symlinkSync(join(outside, "missing.md"), join(workspace, "broken.md"));
      expect(
        run(tools().write_file, { path: join(workspace, "broken.md"), content: "x" }),
      ).rejects.toThrow(/No such path/);
      expect(existsSync(join(outside, "missing.md"))).toBe(false);
    });

    it("writes hidden paths but rejects secret-bearing ones, existing or not", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      const result = await run(tools().write_file, {
        path: join(workspace, ".kiri", "config.yaml"),
        content: "a: 1",
      });
      expect(result).toEqual({ path: ws(".kiri", "config.yaml"), created: true });
      expect(readFileSync(join(workspace, ".kiri", "config.yaml"), "utf8")).toBe("a: 1\n");
      expect(
        run(tools().write_file, { path: join(workspace, ".env"), content: "x" }),
      ).rejects.toThrow(/off-limits/);
      expect(
        run(tools().write_file, {
          path: join(workspace, ".kiri", "mcp-credentials.json"),
          content: "x",
        }),
      ).rejects.toThrow(/off-limits/);
      expect(
        run(tools().write_file, { path: join(workspace, ".git", "config"), content: "x" }),
      ).rejects.toThrow(/off-limits/);
      expect(readFileSync(join(workspace, ".env"), "utf8")).toBe("SECRET=1");
      expect(existsSync(join(workspace, ".git"))).toBe(false);
    });

    it("rejects a directory path", async () => {
      mkdirSync(join(workspace, "sub"));
      expect(
        run(tools().write_file, { path: join(workspace, "sub"), content: "x" }),
      ).rejects.toThrow(/is a directory/);
    });

    it("rejects overwriting a binary file", async () => {
      writeFileSync(join(workspace, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
      expect(
        run(tools().write_file, { path: join(workspace, "blob.bin"), content: "x" }),
      ).rejects.toThrow(/binary file/);
    });

    it("reports an empty sandbox when no directories are configured", async () => {
      expect(
        run(tools([]).write_file, { path: join(workspace, "a.md"), content: "x" }),
      ).rejects.toThrow(/none are configured/);
    });
  });

  describe("edit_file", () => {
    it("replaces a unique occurrence, reporting the change as a unified diff", async () => {
      writeFileSync(join(workspace, "a.md"), "alpha beta gamma\n");
      const result = await run(tools().edit_file, {
        path: join(workspace, "a.md"),
        old_string: "beta",
        new_string: "delta",
      });
      expect(result).toEqual({
        path: ws("a.md"),
        replacements: 1,
        diff: "@@ -1,1 +1,1 @@\n-alpha beta gamma\n+alpha delta gamma",
      });
      expect(readFileSync(join(workspace, "a.md"), "utf8")).toBe("alpha delta gamma\n");
    });

    it("deletes the match when new_string is empty", async () => {
      writeFileSync(join(workspace, "a.md"), "keep drop\n");
      await run(tools().edit_file, {
        path: join(workspace, "a.md"),
        old_string: " drop",
        new_string: "",
      });
      expect(readFileSync(join(workspace, "a.md"), "utf8")).toBe("keep\n");
    });

    it("replaces every occurrence with replace_all, reporting the count", async () => {
      writeFileSync(join(workspace, "a.md"), "x y x y x\n");
      const result = await run(tools().edit_file, {
        path: join(workspace, "a.md"),
        old_string: "x",
        new_string: "z",
        replace_all: true,
      });
      expect(result).toEqual({
        path: ws("a.md"),
        replacements: 3,
        diff: "@@ -1,1 +1,1 @@\n-x y x y x\n+z y z y z",
      });
      expect(readFileSync(join(workspace, "a.md"), "utf8")).toBe("z y z y z\n");
    });

    it("errors when old_string and new_string are identical", async () => {
      writeFileSync(join(workspace, "a.md"), "same\n");
      expect(
        run(tools().edit_file, {
          path: join(workspace, "a.md"),
          old_string: "same",
          new_string: "same",
        }),
      ).rejects.toThrow(/identical — nothing to change/);
    });

    it("errors when old_string is not found, naming read_file as the recovery", async () => {
      writeFileSync(join(workspace, "a.md"), "present\n");
      expect(
        run(tools().edit_file, {
          path: join(workspace, "a.md"),
          old_string: "absent",
          new_string: "x",
        }),
      ).rejects.toThrow(/call read_file and retry/);
    });

    it("errors on an ambiguous match without replace_all, leaving the file untouched", async () => {
      writeFileSync(join(workspace, "a.md"), "dup dup\n");
      expect(
        run(tools().edit_file, {
          path: join(workspace, "a.md"),
          old_string: "dup",
          new_string: "x",
        }),
      ).rejects.toThrow(/appears 2 times .* set replace_all/);
      expect(readFileSync(join(workspace, "a.md"), "utf8")).toBe("dup dup\n");
    });

    it("rejects a missing file, naming find_files as the recovery", async () => {
      expect(
        run(tools().edit_file, {
          path: join(workspace, "gone.md"),
          old_string: "a",
          new_string: "b",
        }),
      ).rejects.toThrow(/call find_files/);
    });

    it("rejects a directory path", async () => {
      mkdirSync(join(workspace, "sub"));
      expect(
        run(tools().edit_file, { path: join(workspace, "sub"), old_string: "a", new_string: "b" }),
      ).rejects.toThrow(/is a directory/);
    });

    it("rejects a binary file", async () => {
      writeFileSync(join(workspace, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47]));
      expect(
        run(tools().edit_file, {
          path: join(workspace, "blob.bin"),
          old_string: "a",
          new_string: "b",
        }),
      ).rejects.toThrow(/binary file/);
    });

    it("rejects secret-bearing paths and paths outside the sandbox", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      writeFileSync(join(outside, "notes.md"), "keep\n");
      expect(
        run(tools().edit_file, {
          path: join(workspace, ".env"),
          old_string: "SECRET",
          new_string: "X",
        }),
      ).rejects.toThrow(/off-limits/);
      expect(
        run(tools().edit_file, {
          path: join(outside, "notes.md"),
          old_string: "keep",
          new_string: "x",
        }),
      ).rejects.toThrow(/outside the directories/);
      expect(readFileSync(join(outside, "notes.md"), "utf8")).toBe("keep\n");
    });
  });

  describe("create_directory", () => {
    it("creates a directory including missing parents", async () => {
      const result = await run(tools().create_directory, {
        path: join(workspace, "a", "b", "c"),
      });
      expect(result).toEqual({ path: ws("a", "b", "c"), created: true });
      expect(existsSync(join(workspace, "a", "b", "c"))).toBe(true);
    });

    it("succeeds without change when the directory already exists", async () => {
      mkdirSync(join(workspace, "sub"));
      const result = await run(tools().create_directory, { path: join(workspace, "sub") });
      expect(result).toEqual({ path: ws("sub"), created: false });
    });

    it("rejects a path that is a file", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(run(tools().create_directory, { path: join(workspace, "a.md") })).rejects.toThrow(
        /is a file/,
      );
    });

    it("creates hidden directories but rejects blocked and escaping paths without touching disk", async () => {
      const result = await run(tools().create_directory, { path: join(workspace, ".kiri") });
      expect(result).toEqual({ path: ws(".kiri"), created: true });
      expect(
        run(tools().create_directory, { path: join(workspace, ".git", "hooks") }),
      ).rejects.toThrow(/off-limits/);
      const escapePath = join(workspace, "..", basename(outside), "made");
      expect(run(tools().create_directory, { path: escapePath })).rejects.toThrow(
        /outside the directories/,
      );
      expect(existsSync(join(workspace, ".git"))).toBe(false);
      expect(existsSync(join(outside, "made"))).toBe(false);
    });
  });

  describe("delete_file", () => {
    it("deletes a file", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      const result = await run(tools().delete_file, { path: join(workspace, "a.md") });
      expect(result).toEqual({ path: ws("a.md"), deleted: true });
      expect(existsSync(join(workspace, "a.md"))).toBe(false);
    });

    it("rejects a directory path, naming delete_directory", async () => {
      mkdirSync(join(workspace, "sub"));
      expect(run(tools().delete_file, { path: join(workspace, "sub") })).rejects.toThrow(
        /call delete_directory instead/,
      );
    });

    it("rejects a missing file", async () => {
      expect(run(tools().delete_file, { path: join(workspace, "gone.md") })).rejects.toThrow(
        /call find_files/,
      );
    });

    it("rejects secret-bearing paths and paths outside the sandbox", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      writeFileSync(join(outside, "keep.md"), "keep");
      expect(run(tools().delete_file, { path: join(workspace, ".env") })).rejects.toThrow(
        /off-limits/,
      );
      expect(run(tools().delete_file, { path: join(outside, "keep.md") })).rejects.toThrow(
        /outside the directories/,
      );
      expect(existsSync(join(workspace, ".env"))).toBe(true);
      expect(existsSync(join(outside, "keep.md"))).toBe(true);
    });
  });

  describe("delete_directory", () => {
    it("deletes an empty directory", async () => {
      mkdirSync(join(workspace, "sub"));
      const result = await run(tools().delete_directory, { path: join(workspace, "sub") });
      expect(result).toEqual({ path: ws("sub"), deleted: true });
      expect(existsSync(join(workspace, "sub"))).toBe(false);
    });

    it("refuses a non-empty directory unless recursive is set", async () => {
      mkdirSync(join(workspace, "sub"));
      writeFileSync(join(workspace, "sub", "a.md"), "a");
      expect(run(tools().delete_directory, { path: join(workspace, "sub") })).rejects.toThrow(
        /not empty — set recursive/,
      );
      expect(existsSync(join(workspace, "sub", "a.md"))).toBe(true);

      const result = await run(tools().delete_directory, {
        path: join(workspace, "sub"),
        recursive: true,
      });
      expect(result).toEqual({ path: ws("sub"), deleted: true });
      expect(existsSync(join(workspace, "sub"))).toBe(false);
    });

    it("rejects a file path, naming delete_file", async () => {
      writeFileSync(join(workspace, "a.md"), "a");
      expect(run(tools().delete_directory, { path: join(workspace, "a.md") })).rejects.toThrow(
        /call delete_file instead/,
      );
    });

    it("never deletes an allowed directory itself", async () => {
      expect(run(tools().delete_directory, { path: workspace })).rejects.toThrow(/never the root/);
      expect(existsSync(workspace)).toBe(true);
    });

    it("rejects a directory outside the sandbox", async () => {
      mkdirSync(join(outside, "sub"));
      expect(run(tools().delete_directory, { path: join(outside, "sub") })).rejects.toThrow(
        /outside the directories/,
      );
      expect(existsSync(join(outside, "sub"))).toBe(true);
    });
  });
});
