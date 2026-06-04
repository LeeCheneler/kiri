import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EntryConfig, stepKind, stepTitle } from "./entry-config.tsx";

describe("step helpers", () => {
  it("derives the kind from the entry shape", () => {
    expect(stepKind({ use: "bundle" })).toBe("use");
    expect(stepKind({ sh: "echo" })).toBe("sh");
  });

  it("titles a use entry with its reference and an sh entry with its first non-empty line", () => {
    expect(stepTitle({ use: "claude-code" })).toBe("claude-code");
    expect(stepTitle({ sh: "\n  echo hi\nmore" })).toBe("echo hi");
  });

  it("prefers an explicit name over the reference or first line", () => {
    expect(stepTitle({ use: "claude-code", name: "Review the PR" })).toBe("Review the PR");
    expect(stepTitle({ sh: "echo hi", name: "Greet" })).toBe("Greet");
  });

  it("truncates a long sh title", () => {
    expect(stepTitle({ sh: "x".repeat(80) })).toBe(`${"x".repeat(60)}…`);
  });
});

describe("<EntryConfig>", () => {
  it("renders the description, source, and env when present", () => {
    render(
      <EntryConfig
        entry={{
          sh: "echo hi",
          description: "does a thing",
          env: { TOKEN: { input: "tok" }, NAME: "kiri" },
        }}
      />,
    );
    expect(screen.getByText("does a thing")).toBeDefined();
    expect(screen.getByText("echo hi")).toBeDefined();
    expect(screen.getByText("{ input: tok }")).toBeDefined();
    expect(screen.getByText("kiri")).toBeDefined();
  });

  it("shows the bundle reference for a use entry", () => {
    render(<EntryConfig entry={{ use: "notify-bundle" }} />);
    expect(screen.getByText("notify-bundle")).toBeDefined();
  });
});
