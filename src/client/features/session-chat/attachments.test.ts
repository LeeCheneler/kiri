import { describe, expect, it } from "bun:test";
import { parseAttachedFile, wrapAttachedFile } from "../../../shared/attached-file.ts";
import { MAX_DOCUMENT_MB, MAX_IMAGE_MB, MAX_TEXT_FILE_KB } from "../../../shared/message-limits.ts";
import {
  attachmentAccept,
  documentFilesFrom,
  imageFilesFrom,
  readPendingDocuments,
  readPendingImages,
  readPendingTextFiles,
  textFilesFrom,
} from "./attachments.ts";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
    expect(error).toContain(`${MAX_IMAGE_MB} MiB`);
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
    expect(error).toContain(`${MAX_TEXT_FILE_KB} KiB`);
  });

  it("keeps the valid files when a sibling is too large", async () => {
    const big = new File([new Uint8Array(MAX_TEXT_FILE_KB * 1024 + 1)], "big.txt");
    const { textFiles, error } = await readPendingTextFiles([new File(["ok"], "ok.md"), big]);
    expect(textFiles).toHaveLength(1);
    expect(textFiles[0].filename).toBe("ok.md");
    expect(error).toBeDefined();
  });
});

describe("documentFilesFrom", () => {
  it("returns nothing for an absent list", () => {
    expect(documentFilesFrom(null)).toEqual([]);
    expect(documentFilesFrom(undefined)).toEqual([]);
  });

  it("keeps document files by extension, case-insensitively, with their media types", () => {
    // Browsers report an empty type for many Office files, so the extension
    // decides — and supplies the media type the part rides as.
    const pdf = new File(["%PDF"], "Brief.PDF");
    const docx = new File(["PK"], "notes.docx", { type: "application/octet-stream" });
    const other = new File(["x"], "photo.png", { type: "image/png" });
    expect(documentFilesFrom(fileList([pdf, docx, other]))).toEqual([
      { file: pdf, mediaType: PDF },
      { file: docx, mediaType: DOCX },
    ]);
  });
});

describe("readPendingDocuments", () => {
  const pdf = { file: new File(["%PDF"], "brief.pdf"), mediaType: PDF };
  const docx = { file: new File(["PK"], "notes.docx"), mediaType: DOCX };

  it("reads accepted documents into data-URL file parts", async () => {
    const { documents, error } = await readPendingDocuments([pdf], [PDF]);
    expect(error).toBeUndefined();
    expect(documents).toHaveLength(1);
    expect(documents[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(documents[0].part).toEqual({
      type: "file",
      mediaType: PDF,
      filename: "brief.pdf",
      url: `data:${PDF};base64,${btoa("%PDF")}`,
    });
  });

  it("skips a type the model does not accept and says which", async () => {
    const { documents, error } = await readPendingDocuments([docx, pdf], [PDF]);
    expect(documents.map((document) => document.part.filename)).toEqual(["brief.pdf"]);
    expect(error).toBe("This model can't read .docx files. Switch model to attach it.");
  });

  it("skips a file over the size cap and reports why", async () => {
    const big = {
      file: new File([new Uint8Array(MAX_DOCUMENT_MB * 1024 * 1024 + 1)], "big.pdf"),
      mediaType: PDF,
    };
    const { documents, error } = await readPendingDocuments([big, pdf], [PDF]);
    expect(documents.map((document) => document.part.filename)).toEqual(["brief.pdf"]);
    expect(error).toBe(`Documents must be ${MAX_DOCUMENT_MB} MiB or smaller.`);
  });
});

describe("attachmentAccept", () => {
  it("offers images, the accepted document types, and text files", () => {
    const accept = attachmentAccept({ images: true, documents: [PDF] }).split(",");
    expect(accept[0]).toBe("image/*");
    expect(accept).toContain(".pdf");
    expect(accept).not.toContain(".docx");
    expect(accept).toContain(".md");
  });

  it("narrows to text files when the model reads neither images nor documents", () => {
    const accept = attachmentAccept({ images: false, documents: [] }).split(",");
    expect(accept).not.toContain("image/*");
    expect(accept).not.toContain(".pdf");
    expect(accept).toContain(".md");
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
