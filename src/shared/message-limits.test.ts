import { describe, expect, it } from "bun:test";
import { wrapAttachedFile } from "./attached-file.ts";
import {
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MESSAGE_PARTS_LIMIT_BYTES,
  MESSAGE_SIZE_ERROR,
  jsonBytes,
  messagePartsError,
} from "./message-limits.ts";

describe("messagePartsError", () => {
  for (const [mediaType, limit, label] of [
    ["image/png", MAX_IMAGE_BYTES, "Images"],
    ["application/pdf", MAX_DOCUMENT_BYTES, "Documents"],
  ] as const) {
    it(`counts decoded ${mediaType} bytes, including base64 padding`, () => {
      const part = (bytes: number) => ({
        type: "file",
        mediaType,
        url: `data:${mediaType};base64,${Buffer.alloc(bytes).toString("base64")}`,
      });
      expect(messagePartsError([part(limit)])).toBeUndefined();
      expect(messagePartsError([part(limit + 1)])).toContain(label);
    });
  }

  it("accepts unpadded base64 supported by the message transport", () => {
    for (const data of ["AA", "AAA", "AAAA", "AA==", "AAA="]) {
      expect(
        messagePartsError([
          { type: "file", mediaType: "image/png", url: `data:image/png;base64,${data}` },
        ]),
      ).toBeUndefined();
    }
  });

  it("measures text attachment content as UTF-8, independently of its wrapper", () => {
    const content = "é".repeat(MAX_TEXT_FILE_BYTES / 2);
    expect(
      messagePartsError([{ type: "text", text: wrapAttachedFile('quoted"name.md', content) }]),
    ).toBeUndefined();
    expect(
      messagePartsError([{ type: "text", text: wrapAttachedFile("a.md", `${content}x`) }]),
    ).toContain("256 KiB");
  });

  it("includes JSON escaping, filenames, and multibyte text in the total budget", () => {
    const text = (value: string) => [{ type: "text", text: value }];
    const remaining = MESSAGE_PARTS_LIMIT_BYTES - jsonBytes(text(""));
    expect(messagePartsError(text("x".repeat(remaining)))).toBeUndefined();
    expect(messagePartsError(text("x".repeat(remaining + 1)))).toBe(MESSAGE_SIZE_ERROR);
    expect(messagePartsError(text("é".repeat(Math.ceil(remaining / 2))))).toBe(MESSAGE_SIZE_ERROR);
    expect(messagePartsError(text('"'.repeat(Math.ceil(remaining / 2))))).toBe(MESSAGE_SIZE_ERROR);
    expect(
      messagePartsError([
        {
          type: "file",
          mediaType: "image/png",
          url: "data:image/png;base64,YQ==",
          filename: "x".repeat(remaining),
        },
      ]),
    ).toBe(MESSAGE_SIZE_ERROR);
  });

  it("checks the sum of individually valid attachments", () => {
    const part = {
      type: "file",
      mediaType: "application/pdf",
      url: `data:application/pdf;base64,${Buffer.alloc(13 * 1024 * 1024).toString("base64")}`,
    };
    expect(messagePartsError([part])).toBeUndefined();
    expect(messagePartsError([part, part])).toBe(MESSAGE_SIZE_ERROR);
  });

  it("rejects encodings whose raw size cannot be checked", () => {
    for (const url of [
      "https://example.com/file.pdf",
      "data:application/pdf,abc",
      "data:application/pdf;base64",
      "data:application/pdf;base64,!!!=",
      "data:application/pdf;base64,YQ=",
    ]) {
      expect(messagePartsError([{ type: "file", mediaType: "application/pdf", url }])).toMatch(
        /base64/,
      );
    }
  });

  it("leaves non-attachment shape validation to the request schema", () => {
    expect(
      messagePartsError([
        null,
        "x",
        {},
        { type: "text", text: "hello" },
        { type: "file" },
        { type: "file", url: "x" },
      ]),
    ).toBeUndefined();
  });
});
