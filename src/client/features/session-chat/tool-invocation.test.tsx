import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolUIPart } from "ai";
import { ToolInvocation } from "./tool-invocation.tsx";

// Build a tool part in a given state; tests cast freely since the part is opaque
// data the component reads, not something it constructs.
const part = (overrides: Record<string, unknown>): ToolUIPart =>
  ({ type: "tool-create_issue", toolCallId: "c1", ...overrides }) as unknown as ToolUIPart;

describe("<ToolInvocation>", () => {
  it("shows the humanised name and a string query, with JSON output once expanded", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          state: "output-available",
          input: { query: "open a bug" },
          output: { id: 42 },
        })}
      />,
    );

    expect(screen.getByText("Create issue")).toBeDefined();
    expect(screen.getByText("open a bug")).toBeDefined();

    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"id": 42/)).toBeDefined();
  });

  it("shows a urls list in the collapsed summary", () => {
    render(
      <ToolInvocation
        part={part({
          state: "output-available",
          input: { urls: ["https://a.test", "https://b.test"] },
          output: {},
        })}
      />,
    );
    expect(screen.getByText("https://a.test, https://b.test")).toBeDefined();
  });

  it("omits the summary detail when the input has neither a query nor urls", () => {
    render(
      <ToolInvocation
        part={part({ state: "output-available", input: { ticket: 1 }, output: {} })}
      />,
    );
    expect(screen.getByText("Create issue")).toBeDefined();
    expect(screen.queryByText("ticket")).toBeNull();
  });

  it("surfaces a tool error", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolInvocation
        part={part({ state: "output-error", input: {}, errorText: "server rejected" })}
      />,
    );

    expect(container.querySelector('[data-status="failed"]')).not.toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("alert").textContent).toBe("server rejected");
  });

  it("shows a running state while the call is in flight", async () => {
    const user = userEvent.setup();
    const { container } = render(<ToolInvocation part={part({ state: "input-available" })} />);

    expect(container.querySelector('[data-status="working"]')).not.toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Running…")).toBeDefined();
  });
});
