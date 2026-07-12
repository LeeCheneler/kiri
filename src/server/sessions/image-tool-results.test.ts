import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { compactImageOutput, stripImageToolResults } from "./image-tool-results.ts";

const imagePart = (output: unknown, state = "output-available"): UIMessage["parts"][number] =>
  ({
    type: "tool-generate_image",
    toolCallId: "c1",
    state,
    input: { prompt: "a red panda" },
    output,
  }) as UIMessage["parts"][number];

const message = (parts: unknown[]): UIMessage =>
  ({ id: "m1", role: "assistant", parts }) as UIMessage;

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

describe("stripImageToolResults", () => {
  it("strips settled generate_image results, leaving the original history untouched", () => {
    const original = message([
      { type: "text", text: "hi" },
      imagePart({ model: "fake:paint", mediaType: "image/png", image: "data:…" }),
    ]);

    const [reshaped] = stripImageToolResults([original]);

    expect(reshaped?.parts[1]).toEqual(imagePart({ model: "fake:paint", mediaType: "image/png" }));
    // The caller's message is a fresh object; persistence keeps the image.
    expect((original.parts[1] as { output: { image?: string } }).output.image).toBe("data:…");
  });

  it("leaves other tools, unsettled calls, and image-free results alone", () => {
    const other = message([
      { type: "tool-write_file", toolCallId: "c2", state: "output-available", output: { x: 1 } },
      imagePart(undefined, "input-available"),
      imagePart({ model: "fake:paint", mediaType: "image/png" }),
    ]);

    expect(stripImageToolResults([other])[0]).toBe(other);
  });
});
