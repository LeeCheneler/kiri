import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Diff, patchFromStrings } from "./diff.tsx";

const PATCH = [
  "@@ -3,5 +3,5 @@",
  " context before",
  "-the old line",
  "+the new line",
  " context after",
].join("\n");

// The kind of the row containing `text`, via its semantic data attribute.
const kindOf = (text: string): string | null | undefined =>
  screen.getByText(text).closest("[data-diff-line]")?.getAttribute("data-diff-line");

describe("<Diff>", () => {
  it("renders each patch line with its kind and hunk-derived line numbers", () => {
    render(<Diff patch={PATCH} />);

    expect(kindOf("the old line")).toBe("removed");
    expect(kindOf("the new line")).toBe("added");
    expect(kindOf("@@ -3,5 +3,5 @@")).toBe("hunk");
    expect(kindOf("context before")).toBe("context");

    // Line 3 is context, so the change sits at line 4 on both sides.
    const removed = screen.getByText("the old line").closest("[data-diff-line]");
    expect(removed?.textContent).toContain("4");
    const added = screen.getByText("the new line").closest("[data-diff-line]");
    expect(added?.textContent).toContain("4");
  });

  it("renders jsdiff's no-newline marker as a meta row", () => {
    render(<Diff patch={"@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file"} />);
    expect(kindOf("No newline at end of file")).toBe("meta");
  });

  it("notes a truncated diff", () => {
    render(<Diff patch={"@@ -1,1 +1,1 @@\n-a\n+b"} truncated />);
    expect(screen.getByText("… diff truncated")).toBeDefined();
  });

  it("renders a mixed header-less pseudo-diff without line numbers", () => {
    render(<Diff patch={patchFromStrings("old body\n", "new body\n")} />);
    expect(kindOf("old body")).toBe("removed");
    expect(kindOf("new body")).toBe("added");
    const removed = screen.getByText("old body").closest("[data-diff-line]");
    expect(removed?.textContent).not.toMatch(/\d/);
  });

  it("numbers a purely one-sided pseudo-diff from 1 — a whole file arriving or going", () => {
    render(<Diff patch={patchFromStrings("", "first\nsecond\n")} />);
    const first = screen.getByText("first").closest("[data-diff-line]");
    const second = screen.getByText("second").closest("[data-diff-line]");
    expect(first?.textContent).toContain("1");
    expect(second?.textContent).toContain("2");
    expect(kindOf("first")).toBe("added");

    render(<Diff patch={patchFromStrings("gone\n", "")} />);
    const gone = screen.getByText("gone").closest("[data-diff-line]");
    expect(kindOf("gone")).toBe("removed");
    expect(gone?.textContent).toContain("1");
  });

  it("renders nothing for an empty patch", () => {
    const { container } = render(<Diff patch="" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("patchFromStrings", () => {
  it("turns before/after into removals then additions, dropping trailing-newline phantoms", () => {
    expect(patchFromStrings("a\nb\n", "c\n")).toBe("-a\n-b\n+c");
  });

  it("handles one empty side — a pure addition or deletion", () => {
    expect(patchFromStrings("", "new\n")).toBe("+new");
    expect(patchFromStrings("gone\n", "")).toBe("-gone");
  });
});
