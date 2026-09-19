import { describe, expect, it } from "bun:test";
import { compactImageOutput } from "./image-tool-results.ts";

describe("compactImageOutput", () => {
  it("drops the image payload, keeping the metadata", () => {
    expect(
      compactImageOutput({ model: "fake:paint", mediaType: "image/png", image: "data:…" }),
    ).toEqual({ model: "fake:paint", mediaType: "image/png" });
  });

  it("passes outputs without an image through untouched", () => {
    const output = { error: "boom" };
    expect(compactImageOutput(output)).toBe(output);
    expect(compactImageOutput("plain text")).toBe("plain text");
    expect(compactImageOutput(null)).toBeNull();
  });
});
