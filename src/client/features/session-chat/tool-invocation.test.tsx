import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolUIPart } from "ai";
import { ToolInvocation } from "./tool-invocation.tsx";

// Build a tool part in a given state (web_search by default; override `type`
// for others); tests cast freely since the part is opaque data the component
// reads, not something it constructs.
const part = (overrides: Record<string, unknown>): ToolUIPart =>
  ({ type: "tool-web_search", toolCallId: "c1", ...overrides }) as unknown as ToolUIPart;

describe("<ToolInvocation>", () => {
  it("shows the query in the collapsed summary and the results once expanded", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          state: "output-available",
          input: { query: "what is bun" },
          output: {
            answer: "Bun is a fast JS runtime.",
            results: [{ title: "Bun", url: "https://bun.sh", content: "All-in-one toolkit." }],
          },
        })}
      />,
    );

    // The humanised tool name and the searched query show before expanding.
    expect(screen.getByText("Web search")).toBeDefined();
    expect(screen.getByText("what is bun")).toBeDefined();
    // The result is collapsed away until the disclosure is opened.
    expect(screen.queryByRole("link")).toBeNull();

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Bun is a fast JS runtime.")).toBeDefined();
    expect(screen.getByText("All-in-one toolkit.")).toBeDefined();
    const link = screen.getByRole("link", { name: /Bun/ });
    expect(link.getAttribute("href")).toBe("https://bun.sh");
  });

  it("renders a non-http result url as inert text, never a link", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          state: "output-available",
          input: { query: "x" },
          output: { results: [{ title: "Evil", url: "javascript:alert(1)", content: "" }] },
        })}
      />,
    );

    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Evil")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("surfaces a tool error", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolInvocation
        part={part({ state: "output-error", input: { query: "x" }, errorText: "tavily failed" })}
      />,
    );

    expect(container.querySelector('[data-status="failed"]')).not.toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("alert").textContent).toBe("tavily failed");
  });

  it("falls back to JSON for output that isn't a web search shape", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation part={part({ state: "output-available", input: {}, output: { ok: 1 } })} />,
    );

    // No string query means no query in the summary.
    expect(screen.queryByText("what is bun")).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"ok": 1/)).toBeDefined();
  });

  it("shows a running state while the call is in flight", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolInvocation part={part({ state: "input-available", input: { query: "x" } })} />,
    );

    expect(container.querySelector('[data-status="working"]')).not.toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Running…")).toBeDefined();
  });

  it("renders web_extract with the target url in the summary and page content once expanded", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          type: "tool-web_extract",
          state: "output-available",
          input: { urls: ["https://bun.sh/docs"] },
          output: {
            results: [{ url: "https://bun.sh/docs", content: "Full page content." }],
            failed: [],
          },
        })}
      />,
    );

    expect(screen.getByText("Web extract")).toBeDefined();
    expect(screen.getByText("https://bun.sh/docs")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Full page content.")).toBeDefined();
    const link = screen.getByRole("link", { name: /bun\.sh\/docs/ });
    expect(link.getAttribute("href")).toBe("https://bun.sh/docs");
  });

  it("lists urls that failed to extract", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          type: "tool-web_extract",
          state: "output-available",
          input: { urls: ["https://nope.test"] },
          output: { results: [], failed: [{ url: "https://nope.test", error: "Not found" }] },
        })}
      />,
    );

    await user.click(screen.getByRole("button"));
    expect(screen.getByText("https://nope.test: Not found")).toBeDefined();
  });
});
