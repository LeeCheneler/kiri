import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ToolUIPart } from "ai";
import {
  CANCELLED_ERROR_TEXT,
  type ToolDecisionHandler,
  ToolInvocation,
} from "./tool-invocation.tsx";

// Build a tool part in a given state; tests cast freely since the part is opaque
// data the component reads, not something it constructs.
const part = (overrides: Record<string, unknown>): ToolUIPart =>
  ({ type: "tool-create_issue", toolCallId: "c1", ...overrides }) as unknown as ToolUIPart;

const pendingApproval = (): ToolUIPart =>
  part({ state: "approval-requested", input: { title: "Bug" }, approval: { id: "a1" } });

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

  it("offers Allow / Always allow / Deny with the input shown, when a call awaits approval", () => {
    render(<ToolInvocation part={pendingApproval()} onDecision={() => {}} />);

    expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
    // The call's input is shown up front so the decision is informed.
    expect(screen.getByText(/"title": "Bug"/)).toBeDefined();
  });

  it("reports the matching verdict for each approval action", async () => {
    const user = userEvent.setup();
    const onDecision = mock<ToolDecisionHandler>(() => {});
    const approval = pendingApproval();
    render(<ToolInvocation part={approval} onDecision={onDecision} />);

    await user.click(screen.getByRole("button", { name: "Allow" }));
    await user.click(screen.getByRole("button", { name: "Always allow" }));
    await user.click(screen.getByRole("button", { name: "Deny" }));

    expect(onDecision.mock.calls).toEqual([
      [approval, "allow"],
      [approval, "always"],
      [approval, "deny"],
    ]);
  });

  it("falls back to the collapsed block when no decision handler is wired", () => {
    const { container } = render(<ToolInvocation part={pendingApproval()} />);

    // No verdict to give — just the pending status, no Allow control.
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
    expect(container.querySelector('[data-status="pending"]')).not.toBeNull();
  });

  it("offers a Cancel control while a call is in flight and reports it", async () => {
    const user = userEvent.setup();
    const onCancel = mock(() => {});
    render(
      <ToolInvocation part={part({ state: "input-available", input: {} })} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows a cancelled call as cancelled, not failed, explaining it once expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolInvocation
        part={part({ state: "output-error", input: {}, errorText: CANCELLED_ERROR_TEXT })}
      />,
    );

    expect(container.querySelector('[data-status="cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-status="failed"]')).toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("You cancelled this call.")).toBeDefined();
  });

  it("shows a denied call as cancelled, explaining it once expanded", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ToolInvocation part={part({ state: "output-denied", input: { title: "Bug" } })} />,
    );

    expect(container.querySelector('[data-status="cancelled"]')).not.toBeNull();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("You denied this call.")).toBeDefined();
  });
});
