import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { EntryConfig, stepKind, stepTitle } from "./entry-config.tsx";

describe("step helpers", () => {
  it("derives the kind from the entry shape", () => {
    expect(stepKind({ use: "bundle" })).toBe("use");
    expect(stepKind({ sh: "echo" })).toBe("sh");
    expect(stepKind({ llm: { model: "anthropic:claude-haiku-4-5" } })).toBe("llm");
  });

  it("titles a use entry with its reference and an sh entry with its first non-empty line", () => {
    expect(stepTitle({ use: "claude-code" })).toBe("claude-code");
    expect(stepTitle({ sh: "\n  echo hi\nmore" })).toBe("echo hi");
  });

  it("titles an llm entry with its model id", () => {
    expect(stepTitle({ llm: { model: "anthropic:claude-haiku-4-5" } })).toBe(
      "anthropic:claude-haiku-4-5",
    );
  });

  it("prefers an explicit name over the reference, model, or first line", () => {
    expect(stepTitle({ use: "claude-code", name: "Review the PR" })).toBe("Review the PR");
    expect(stepTitle({ sh: "echo hi", name: "Greet" })).toBe("Greet");
    expect(stepTitle({ llm: { model: "anthropic:claude-haiku-4-5" }, name: "Summarise" })).toBe(
      "Summarise",
    );
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

  it("renders step, article, and env refs in their YAML form", () => {
    render(
      <EntryConfig
        entry={{
          sh: "echo hi",
          env: {
            EDITION: { step: "fetch" },
            DIGEST: { article: "edition" },
            TOKEN: { env: "MY_TOKEN" },
          },
        }}
      />,
    );
    expect(screen.getByText("{ step: fetch }")).toBeDefined();
    expect(screen.getByText("{ article: edition }")).toBeDefined();
    expect(screen.getByText("{ env: MY_TOKEN }")).toBeDefined();
  });

  it("renders a named-output ref with its output field", () => {
    render(
      <EntryConfig
        entry={{
          sh: "echo hi",
          env: { COUNT: { step: "fetch", output: "my_prs_count" } },
        }}
      />,
    );
    expect(screen.getByText("{ step: fetch, output: my_prs_count }")).toBeDefined();
  });

  it("shows the bundle reference for a use entry", () => {
    render(<EntryConfig entry={{ use: "notify-bundle" }} />);
    expect(screen.getByText("notify-bundle")).toBeDefined();
  });

  it("shows the model and inline prompt for an llm entry", () => {
    render(
      <EntryConfig
        entry={{ llm: { model: "anthropic:claude-haiku-4-5", prompt: "Summarise the run." } }}
      />,
    );
    expect(screen.getByText("anthropic:claude-haiku-4-5")).toBeDefined();
    expect(screen.getByText("Summarise the run.")).toBeDefined();
  });

  it("shows the prompt file path for an llm entry declaring one", () => {
    render(
      <EntryConfig entry={{ llm: { model: "local:llama3", prompt_file: "prompts/review.tpl" } }} />,
    );
    expect(screen.getByText("local:llama3")).toBeDefined();
    expect(screen.getByText("prompts/review.tpl")).toBeDefined();
  });

  it("shows only the model for an llm entry with no prompt (summariser default)", () => {
    render(<EntryConfig entry={{ llm: { model: "anthropic:claude-haiku-4-5" } }} />);
    expect(screen.getByText("anthropic:claude-haiku-4-5")).toBeDefined();
    expect(screen.queryByText(/prompt/i)).toBeNull();
  });
});
