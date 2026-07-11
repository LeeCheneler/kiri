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

  // Build a filesystem write-tool part; the write tools get diff rendering
  // rather than the generic JSON panels.
  const writePart = (tool: string, overrides: Record<string, unknown>): ToolUIPart =>
    ({ type: `tool-${tool}`, toolCallId: "c1", ...overrides }) as unknown as ToolUIPart;

  it("shows the path in the collapsed summary for filesystem calls", () => {
    render(
      <ToolInvocation
        part={writePart("delete_file", {
          state: "output-available",
          input: { path: "/ws/old.md" },
          output: { path: "/ws/old.md", deleted: true },
        })}
      />,
    );
    expect(screen.getByText("/ws/old.md")).toBeDefined();
  });

  it("renders a write result's diff as toned rows instead of JSON", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("edit_file", {
          state: "output-available",
          input: { path: "/ws/a.md", old_string: "old line", new_string: "new line" },
          output: {
            path: "/ws/a.md",
            replacements: 1,
            diff: "@@ -1,1 +1,1 @@\n-old line\n+new line",
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button"));
    const removed = screen.getByText("old line").closest("[data-diff-line]");
    expect(removed?.getAttribute("data-diff-line")).toBe("removed");
    expect(
      screen.getByText("new line").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
    expect(screen.queryByText(/"replacements"/)).toBeNull();
  });

  it("notes a truncated diff on a write result", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("write_file", {
          state: "output-available",
          input: { path: "/ws/a.md", content: "next\n" },
          output: {
            path: "/ws/a.md",
            created: false,
            diff: "@@ -1,9 +1,1 @@",
            diffTruncated: true,
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("… diff truncated")).toBeDefined();
  });

  it("renders a created file's content as additions, from the call's input", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("write_file", {
          state: "output-available",
          input: { path: "/ws/new.md", content: "fresh line\n" },
          output: { path: "/ws/new.md", created: true },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText("fresh line").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
  });

  it("previews an edit awaiting approval as a change, not JSON", () => {
    render(
      <ToolInvocation
        part={writePart("edit_file", {
          state: "approval-requested",
          input: {
            path: "/ws/a.md",
            old_string: "old line",
            new_string: "new line",
            replace_all: true,
          },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );

    expect(screen.getByText("/ws/a.md")).toBeDefined();
    expect(
      screen.getByText("old line").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("removed");
    expect(
      screen.getByText("new line").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
    expect(screen.getByText("Applies to every occurrence.")).toBeDefined();
    expect(screen.queryByText(/"old_string"/)).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDefined();
  });

  it("previews a write awaiting approval as its content added", () => {
    render(
      <ToolInvocation
        part={writePart("write_file", {
          state: "approval-requested",
          input: { path: "/ws/new.md", content: "incoming\n" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(
      screen.getByText("incoming").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
  });

  it("keeps the JSON input for approvals with nothing diffable to show", () => {
    render(
      <ToolInvocation
        part={writePart("delete_directory", {
          state: "approval-requested",
          input: { path: "/ws/scratch", recursive: true },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText(/"recursive": true/)).toBeDefined();
  });

  it("falls back to JSON when a write part carries no renderable change", async () => {
    const user = userEvent.setup();
    // A created-file result whose input lacks the content string — nothing to
    // rebuild the change from, so the raw output shows instead.
    render(
      <ToolInvocation
        part={writePart("write_file", {
          state: "output-available",
          input: {},
          output: { path: "/ws/new.md", created: true },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"created": true/)).toBeDefined();
  });

  it("falls back to the JSON input for a malformed write approval", () => {
    render(
      <ToolInvocation
        part={writePart("write_file", {
          state: "approval-requested",
          input: { path: "/ws/new.md" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText(/"path": "\/ws\/new.md"/)).toBeDefined();

    render(
      <ToolInvocation
        part={writePart("edit_file", {
          state: "approval-requested",
          input: { path: "/ws/a.md", old_string: "x" },
          approval: { id: "a2" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText(/"old_string": "x"/)).toBeDefined();
  });
});
