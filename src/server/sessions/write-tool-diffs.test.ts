import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";
import { compactWriteOutput, stripWriteToolDiffs } from "./write-tool-diffs.ts";

describe("compactWriteOutput", () => {
  it("drops the diff fields, keeping the metadata", () => {
    expect(
      compactWriteOutput({
        path: "/ws/a.md",
        replacements: 2,
        diff: "-a\n+b",
        diffTruncated: true,
      }),
    ).toEqual({ path: "/ws/a.md", replacements: 2 });
  });

  it("returns diff-less outputs unchanged, by identity", () => {
    const output = { path: "/ws/a.md", created: true };
    expect(compactWriteOutput(output)).toBe(output);
    expect(compactWriteOutput("plain text")).toBe("plain text");
    expect(compactWriteOutput(null)).toBe(null);
  });
});

describe("stripWriteToolDiffs", () => {
  const message = (parts: UIMessage["parts"]): UIMessage => ({
    id: "m1",
    role: "assistant",
    parts,
  });

  it("strips the diff from settled write-tool results, leaving storage's copy alone", () => {
    const history = [
      message([
        {
          type: "tool-edit_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "/ws/a.md", old_string: "a", new_string: "b" },
          output: { path: "/ws/a.md", replacements: 1, diff: "-a\n+b" },
        },
      ] as UIMessage["parts"]),
    ];

    const [stripped] = stripWriteToolDiffs(history);
    expect(stripped.parts[0]).toMatchObject({
      output: { path: "/ws/a.md", replacements: 1 },
    });
    expect("diff" in (stripped.parts[0] as { output: object }).output).toBe(false);
    // Pure: the caller's history — which feeds persistence — is untouched.
    expect(history[0].parts[0]).toMatchObject({ output: { diff: "-a\n+b" } });
  });

  it("leaves other tools, unsettled calls, and diff-less results as they are", () => {
    const parts = [
      { type: "text", text: "done" },
      {
        type: "tool-search",
        toolCallId: "c1",
        state: "output-available",
        input: {},
        output: { diff: "not ours" },
      },
      {
        type: "tool-write_file",
        toolCallId: "c2",
        state: "input-available",
        input: { path: "/ws/a.md", content: "b\n" },
      },
      {
        type: "tool-write_file",
        toolCallId: "c3",
        state: "output-available",
        input: { path: "/ws/new.md", content: "b\n" },
        output: { path: "/ws/new.md", created: true },
      },
    ] as UIMessage["parts"];
    const history = [message(parts)];

    const [result] = stripWriteToolDiffs(history);
    // Nothing to change, so the message comes back by identity.
    expect(result).toBe(history[0]);
  });
});
