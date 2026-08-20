import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import { ToolChain, segmentParts } from "./tool-chain.tsx";
import { CANCELLED_ERROR_TEXT, type ToolPart } from "./tool-invocation.tsx";

// Build a tool part in a given state; tests cast freely since the part is
// opaque data the code reads, not something it constructs.
const tool = (id: string, overrides: Record<string, unknown> = {}): ToolPart =>
  ({
    type: "tool-read_file",
    toolCallId: id,
    state: "output-available",
    input: { path: `/ws/${id}.md` },
    output: {},
    ...overrides,
  }) as unknown as ToolPart;

const parts = (...list: unknown[]): UIMessage["parts"] => list as UIMessage["parts"];

describe("segmentParts", () => {
  it("folds consecutive tool calls into one chain, across step boundaries and empty text", () => {
    const [a, b, c] = [tool("a"), tool("b"), tool("c")];
    const segments = segmentParts(
      parts(
        { type: "text", text: "Let me dig in." },
        a,
        { type: "step-start" },
        b,
        { type: "text", text: "" },
        c,
        { type: "text", text: "Done." },
      ),
    );

    expect(segments).toEqual([
      { kind: "text", index: 0, text: "Let me dig in." },
      { kind: "chain", parts: [a, b, c] as ToolPart[] },
      { kind: "text", index: 6, text: "Done." },
    ]);
  });

  it("breaks a chain on prose between calls", () => {
    const [a, b] = [tool("a"), tool("b")];
    const segments = segmentParts(parts(a, { type: "text", text: "So far so good." }, b));

    expect(segments).toEqual([
      { kind: "chain", parts: [a] as ToolPart[] },
      { kind: "text", index: 1, text: "So far so good." },
      { kind: "chain", parts: [b] as ToolPart[] },
    ]);
  });

  it("keeps a call awaiting approval out of any chain", () => {
    const [a, c] = [tool("a"), tool("c")];
    const pending = tool("b", { state: "approval-requested", approval: { id: "ap1" } });
    const segments = segmentParts(parts(a, pending, c));

    expect(segments).toEqual([
      { kind: "chain", parts: [a] as ToolPart[] },
      { kind: "approval", part: pending },
      { kind: "chain", parts: [c] as ToolPart[] },
    ]);
  });

  it("keeps a delegate call out of any chain", () => {
    const [a, c] = [tool("a"), tool("c")];
    const delegate = tool("b", {
      type: "tool-delegate",
      state: "input-available",
      input: { task: "Research pelicans" },
    });
    const segments = segmentParts(parts(a, delegate, c));

    expect(segments).toEqual([
      { kind: "chain", parts: [a] as ToolPart[] },
      { kind: "delegate", part: delegate },
      { kind: "chain", parts: [c] as ToolPart[] },
    ]);
  });

  it("keeps a settled generated image out of any chain, while an unsettled one chains", () => {
    const [a, c] = [tool("a"), tool("c")];
    const settled = tool("b", {
      type: "tool-generate_image",
      input: { prompt: "a red panda" },
      output: { model: "fake:paint", mediaType: "image/png", image: "data:image/png;base64,AA" },
    });
    expect(segmentParts(parts(a, settled, c))).toEqual([
      { kind: "chain", parts: [a] as ToolPart[] },
      { kind: "image", part: settled },
      { kind: "chain", parts: [c] as ToolPart[] },
    ]);

    // Still generating: nothing to show yet, so it folds like any other call.
    const inFlight = tool("b", {
      type: "tool-generate_image",
      state: "input-available",
      input: { prompt: "a red panda" },
    });
    expect(segmentParts(parts(a, inFlight, c))).toEqual([
      { kind: "chain", parts: [a, inFlight, c] as ToolPart[] },
    ]);
  });

  it("yields nothing for parts that render nothing", () => {
    expect(segmentParts(parts())).toEqual([]);
    expect(
      segmentParts(
        parts(
          { type: "step-start" },
          { type: "text", text: "" },
          { type: "file", mediaType: "image/png", url: "data:image/png;base64,AA" },
        ),
      ),
    ).toEqual([]);
  });
});

describe("<ToolChain>", () => {
  it("summarises the chain with its call count and distinct tools", () => {
    render(
      <ToolChain
        parts={[
          tool("a"),
          tool("b"),
          tool("c", { type: "tool-create_issue", input: { query: "bug" } }),
        ]}
      />,
    );

    expect(screen.getByText("3 tool calls")).toBeDefined();
    // Tools are listed once each, however many times they were called.
    expect(screen.getByText("Read file, Create issue")).toBeDefined();
  });

  it("shows a working cue while any call is still resolving", () => {
    const working = render(
      <ToolChain
        parts={[
          tool("a", { state: "output-error", errorText: "boom" }),
          tool("b", { state: "input-available" }),
        ]}
      />,
    );
    expect(working.container.querySelector('[data-status="working"]')).not.toBeNull();
  });

  it("rolls up no outcome once every call has settled", () => {
    // A settled chain shows no status even when a call failed or was
    // cancelled: the model routinely recovers from a failed call within the
    // same chain, so a rolled-up outcome would misread self-recovery. The
    // outcomes live on the individual rows when expanded.
    const settled = render(
      <ToolChain
        parts={[
          tool("a"),
          tool("b", { state: "output-error", errorText: "boom" }),
          tool("c", { state: "output-error", errorText: CANCELLED_ERROR_TEXT }),
        ]}
      />,
    );
    expect(settled.container.querySelector("[data-status]")).toBeNull();
  });

  it("expands to the individual calls, each expandable in turn to its result", async () => {
    const user = userEvent.setup();
    render(<ToolChain parts={[tool("a", { output: { lines: 42 } }), tool("b")]} />);

    // Collapsed, the individual calls are not shown.
    expect(screen.queryByText("/ws/a.md")).toBeNull();

    await user.click(screen.getByRole("button", { name: /2 tool calls/ }));
    expect(screen.getByText("/ws/a.md")).toBeDefined();
    expect(screen.getByText("/ws/b.md")).toBeDefined();

    // Each row is the usual collapsible invocation, expanding to its result.
    await user.click(screen.getByRole("button", { name: /\/ws\/a\.md/ }));
    expect(screen.getByText(/"lines": 42/)).toBeDefined();
  });
});

describe("segmentParts inbox deliveries", () => {
  it("keeps a delivered inbox message out of any chain, at its woven position", () => {
    const [a, b] = [tool("a"), tool("b")];
    const inbox = {
      type: "data-inbox",
      id: "i1",
      data: { source: "user", text: "also check X", queuedAt: 1 },
    };
    const segments = segmentParts(parts(a, inbox, b));

    expect(segments).toEqual([
      { kind: "chain", parts: [a] as ToolPart[] },
      { kind: "inbox", part: inbox as never },
      { kind: "chain", parts: [b] as ToolPart[] },
    ]);
  });
});
