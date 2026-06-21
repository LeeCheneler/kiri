import { describe, expect, it } from "bun:test";
import {
  MAX_IMAGE_MB,
  MAX_TEXT_FILE_KB,
  imageFilesFrom,
  parseAttachedFile,
  readPendingImages,
  readPendingTextFiles,
  textFilesFrom,
  wrapAttachedFile,
} from "./attachments.ts";

const fileList = (files: File[]) => files as unknown as FileList;
const oversize = () =>
  new File([new Uint8Array(MAX_IMAGE_MB * 1024 * 1024 + 1)], "big.png", { type: "image/png" });

describe("imageFilesFrom", () => {
  it("returns nothing for an absent list", () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
  });

  it("keeps only image files", () => {
    const png = new File(["x"], "a.png", { type: "image/png" });
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    expect(imageFilesFrom(fileList([png, txt]))).toEqual([png]);
  });
});

describe("readPendingImages", () => {
  it("reads images into data-URL file parts", async () => {
    const { images, error } = await readPendingImages([
      new File(["hello"], "shot.png", { type: "image/png" }),
    ]);
    expect(error).toBeUndefined();
    expect(images).toHaveLength(1);
    expect(images[0].part).toMatchObject({
      type: "file",
      mediaType: "image/png",
      filename: "shot.png",
    });
    expect(images[0].part.url.startsWith("data:image/png")).toBe(true);
    expect(images[0].id).toBeTruthy();
  });

  it("skips a file over the size cap and reports why", async () => {
    const { images, error } = await readPendingImages([oversize()]);
    expect(images).toHaveLength(0);
    expect(error).toContain(`${MAX_IMAGE_MB} MB`);
  });

  it("keeps the valid images when a sibling is too large", async () => {
    const { images, error } = await readPendingImages([
      new File(["hi"], "ok.png", { type: "image/png" }),
      oversize(),
    ]);
    expect(images).toHaveLength(1);
    expect(images[0].part.filename).toBe("ok.png");
    expect(error).toBeDefined();
  });
});

describe("textFilesFrom", () => {
  it("returns nothing for an absent list", () => {
    expect(textFilesFrom(null)).toEqual([]);
    expect(textFilesFrom(undefined)).toEqual([]);
  });

  it("keeps only allowlisted text files, case-insensitively", () => {
    const md = new File(["x"], "notes.MD");
    const ts = new File(["x"], "a.ts");
    const png = new File(["x"], "a.png", { type: "image/png" });
    const noExt = new File(["x"], "Dockerfile");
    expect(textFilesFrom(fileList([md, ts, png, noExt]))).toEqual([md, ts]);
  });
});

describe("readPendingTextFiles", () => {
  it("reads files into filename and contents", async () => {
    const { textFiles, error } = await readPendingTextFiles([
      new File(["# Title\nbody"], "doc.md"),
    ]);
    expect(error).toBeUndefined();
    expect(textFiles).toHaveLength(1);
    expect(textFiles[0]).toMatchObject({ filename: "doc.md", content: "# Title\nbody" });
    expect(textFiles[0].id).toBeTruthy();
  });

  it("skips a file over the size cap and reports why", async () => {
    const big = new File([new Uint8Array(MAX_TEXT_FILE_KB * 1024 + 1)], "big.txt");
    const { textFiles, error } = await readPendingTextFiles([big]);
    expect(textFiles).toHaveLength(0);
    expect(error).toContain(`${MAX_TEXT_FILE_KB} KB`);
  });

  it("keeps the valid files when a sibling is too large", async () => {
    const big = new File([new Uint8Array(MAX_TEXT_FILE_KB * 1024 + 1)], "big.txt");
    const { textFiles, error } = await readPendingTextFiles([new File(["ok"], "ok.md"), big]);
    expect(textFiles).toHaveLength(1);
    expect(textFiles[0].filename).toBe("ok.md");
    expect(error).toBeDefined();
  });
});

describe("wrapAttachedFile / parseAttachedFile", () => {
  it("round-trips a filename and multi-line content", () => {
    const wrapped = wrapAttachedFile("a.md", "line 1\nline 2");
    expect(parseAttachedFile(wrapped)).toEqual({ filename: "a.md", content: "line 1\nline 2" });
  });

  it("round-trips empty content", () => {
    expect(parseAttachedFile(wrapAttachedFile("empty.txt", ""))).toEqual({
      filename: "empty.txt",
      content: "",
    });
  });

  it("normalises quotes in the name so it stays parseable", () => {
    expect(parseAttachedFile(wrapAttachedFile('a"b".md', "x"))).toEqual({
      filename: "a'b'.md",
      content: "x",
    });
  });

  it("returns null for ordinary typed text", () => {
    expect(parseAttachedFile("just a normal message")).toBeNull();
  });
});
