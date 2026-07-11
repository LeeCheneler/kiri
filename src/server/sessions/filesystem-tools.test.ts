import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "kiri-fs-tools-"));
    outside = mkdtempSync(join(tmpdir(), "kiri-fs-outside-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  const tools = (allowed: string[] = [workspace], options: FilesystemToolsOptions = {}): ToolSet =>
    filesystemTools(() => allowed, options);

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

    it("never lists hidden files or files under hidden directories", async () => {
      writeFileSync(join(workspace, "visible.md"), "ok");
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      mkdirSync(join(workspace, ".kiri"));
      writeFileSync(join(workspace, ".kiri", "credentials.json"), "{}");
      const result = await run(tools().find_files, { pattern: "**/*" });
      expect(result).toEqual({ files: [ws("visible.md")] });
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

    it("rejects hidden paths", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=1");
      mkdirSync(join(workspace, ".kiri"));
      writeFileSync(join(workspace, ".kiri", "credentials.json"), "{}");
      expect(run(tools().read_file, { path: join(workspace, ".env") })).rejects.toThrow(/hidden/);
      expect(
        run(tools().read_file, { path: join(workspace, ".kiri", "credentials.json") }),
      ).rejects.toThrow(/hidden/);
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

    it("never searches hidden files", async () => {
      writeFileSync(join(workspace, ".env"), "SECRET=hit\n");
      const result = await run(tools().search_files, { pattern: "hit" });
      expect(result).toEqual({ matches: [] });
    });

    it("returns an empty match list when nothing matches", async () => {
      writeFileSync(join(workspace, "a.md"), "quiet\n");
      const result = await run(tools().search_files, { pattern: "absent" });
      expect(result).toEqual({ matches: [] });
    });
  });
});
