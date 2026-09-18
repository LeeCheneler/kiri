import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { parseAttachedFile, wrapAttachedFile } from "../../../shared/attached-file.ts";
import { MAX_DOCUMENT_MB, MAX_IMAGE_MB, MAX_TEXT_FILE_KB } from "../../../shared/message-limits.ts";
import {
  type PickedFile,
  attachmentAccept,
  attachmentName,
  attachmentParts,
  pickedFilesFrom,
  readAttachment,
  screenPickedFiles,
  stagedAttachmentsFrom,
} from "./attachments.ts";

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EVERYTHING = { images: true, documents: [PDF, DOCX] };

const fileList = (files: File[]) => files as unknown as FileList;
const image = (name: string, bytes: BlobPart = "img"): PickedFile => ({
  file: new File([bytes], name, { type: "image/png" }),
  kind: "image",
  mediaType: "image/png",
});
const pdf = (name: string, bytes: BlobPart = "%PDF"): PickedFile => ({
  file: new File([bytes], name),
  kind: "document",
  mediaType: PDF,
});
const text = (name: string, bytes: BlobPart = "hello"): PickedFile => ({
  file: new File([bytes], name),
  kind: "text",
});

describe("pickedFilesFrom", () => {
  it("returns nothing for an absent list", () => {
    expect(pickedFilesFrom(null)).toEqual([]);
    expect(pickedFilesFrom(undefined)).toEqual([]);
  });

  it("classifies images by type and documents and text files by extension, in the order given", () => {
    const notes = new File(["x"], "NOTES.MD");
    const brief = new File(["x"], "Brief.PDF");
    const png = new File(["x"], "a.png", { type: "image/png" });
    const report = new File(["x"], "report.docx");
    expect(pickedFilesFrom(fileList([notes, brief, png, report]))).toEqual([
      { file: notes, kind: "text" },
      { file: brief, kind: "document", mediaType: PDF },
      { file: png, kind: "image", mediaType: "image/png" },
      { file: report, kind: "document", mediaType: DOCX },
    ]);
  });

  it("ignores files it can't attach", () => {
    const zip = new File(["x"], "archive.zip", { type: "application/zip" });
    const bare = new File(["x"], "Makefile");
    expect(pickedFilesFrom(fileList([zip, bare]))).toEqual([]);
  });
});

describe("screenPickedFiles", () => {
  it("accepts files the model reads that fit their size caps", () => {
    const files = [image("a.png"), pdf("b.pdf"), text("c.md")];
    expect(screenPickedFiles(files, EVERYTHING)).toEqual({ accepted: files, errors: [] });
  });

  it("refuses each kind over its size cap and says why", () => {
    const { accepted, errors } = screenPickedFiles(
      [
        image("big.png", new Uint8Array(MAX_IMAGE_MB * 1024 * 1024 + 1)),
        pdf("big.pdf", new Uint8Array(MAX_DOCUMENT_MB * 1024 * 1024 + 1)),
        text("big.md", new Uint8Array(MAX_TEXT_FILE_KB * 1024 + 1)),
      ],
      EVERYTHING,
    );
    expect(accepted).toEqual([]);
    expect(errors).toEqual([
      `Images must be ${MAX_IMAGE_MB} MiB or smaller.`,
      `Documents must be ${MAX_DOCUMENT_MB} MiB or smaller.`,
      `Text files must be ${MAX_TEXT_FILE_KB} KiB or smaller.`,
    ]);
  });

  it("refuses images for a text-only model, once however many were picked", () => {
    const notes = text("notes.md");
    const { accepted, errors } = screenPickedFiles([image("a.png"), notes, image("b.png")], {
      images: false,
      documents: [],
    });
    expect(accepted).toEqual([notes]);
    expect(errors).toEqual(["This model reads text only. Switch model to attach images."]);
  });

  it("refuses a document type the model does not accept and says which", () => {
    const { accepted, errors } = screenPickedFiles([pdf("brief.pdf")], {
      images: true,
      documents: [DOCX],
    });
    expect(accepted).toEqual([]);
    expect(errors).toEqual(["This model can't read .pdf files. Switch model to attach it."]);
  });

  it("keeps the valid files when a sibling is refused", () => {
    const ok = image("ok.png");
    const { accepted, errors } = screenPickedFiles(
      [ok, image("big.png", new Uint8Array(MAX_IMAGE_MB * 1024 * 1024 + 1))],
      EVERYTHING,
    );
    expect(accepted).toEqual([ok]);
    expect(errors).toHaveLength(1);
  });
});

describe("readAttachment", () => {
  it("reads an image into a data-URL file part", async () => {
    const attachment = await readAttachment("a1", image("shot.png", "hello"));
    expect(attachment).toEqual({
      id: "a1",
      kind: "image",
      part: {
        type: "file",
        mediaType: "image/png",
        filename: "shot.png",
        url: `data:image/png;base64,${btoa("hello")}`,
      },
    });
  });

  it("reads a document under the media type its extension maps to", async () => {
    const attachment = await readAttachment("a1", pdf("brief.pdf"));
    expect(attachment).toEqual({
      id: "a1",
      kind: "document",
      part: {
        type: "file",
        mediaType: PDF,
        filename: "brief.pdf",
        url: `data:${PDF};base64,${btoa("%PDF")}`,
      },
    });
  });

  it("reads a text file into its filename and contents", async () => {
    expect(await readAttachment("a1", text("notes.md", "# Title\nbody"))).toEqual({
      id: "a1",
      kind: "text",
      filename: "notes.md",
      content: "# Title\nbody",
    });
  });
});

describe("attachmentName", () => {
  it("names a text file by its filename and a file part by its own", () => {
    expect(attachmentName({ id: "1", kind: "text", filename: "notes.md", content: "" })).toBe(
      "notes.md",
    );
    expect(
      attachmentName({
        id: "2",
        kind: "document",
        part: { type: "file", mediaType: PDF, filename: "brief.pdf", url: "data:," },
      }),
    ).toBe("brief.pdf");
  });

  it("names a file still being read by its filename", () => {
    expect(attachmentName({ id: "1", kind: "reading", filename: "notes.md" })).toBe("notes.md");
  });

  it("falls back to the kind when a restored file part carries no filename", () => {
    const part = { type: "file" as const, mediaType: PDF, url: "data:," };
    expect(attachmentName({ id: "1", kind: "image", part })).toBe("Attached image");
    expect(attachmentName({ id: "2", kind: "document", part })).toBe("Attached document");
  });
});

describe("attachmentParts / stagedAttachmentsFrom", () => {
  const shot = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,AA" };
  const brief = { type: "file" as const, mediaType: PDF, url: `data:${PDF};base64,AA` };
  const message: UIMessage = {
    id: "m1",
    role: "user",
    parts: [
      { type: "text", text: wrapAttachedFile("notes.md", "body") },
      brief,
      shot,
      { type: "text", text: "what are these?" },
    ],
  };

  it("restages a sent message's attachments in the order sent, skipping the typed text", () => {
    expect(stagedAttachmentsFrom(message)).toEqual([
      { id: "m1-0", kind: "text", filename: "notes.md", content: "body" },
      { id: "m1-1", kind: "document", part: brief },
      { id: "m1-2", kind: "image", part: shot },
    ]);
  });

  it("ignores parts that are not attachments", () => {
    expect(
      stagedAttachmentsFrom({ id: "m2", role: "user", parts: [{ type: "step-start" }] }),
    ).toEqual([]);
  });

  it("assembles staged attachments back into the parts they were sent as", () => {
    expect(attachmentParts(stagedAttachmentsFrom(message))).toEqual(message.parts.slice(0, 3));
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
