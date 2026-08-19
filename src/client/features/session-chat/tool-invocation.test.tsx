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

  it("shows a name in the collapsed summary", () => {
    render(
      <ToolInvocation
        part={part({
          type: "tool-use_skill",
          state: "output-available",
          input: { name: "workflow-authoring" },
          output: {},
        })}
      />,
    );
    expect(screen.getByText("workflow-authoring")).toBeDefined();
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

  it("renders a settled generated image below the block, with the prompt as detail", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          type: "tool-generate_image",
          state: "output-available",
          input: { prompt: "a red panda" },
          output: {
            model: "fake:paint",
            mediaType: "image/png",
            image: "data:image/png;base64,AAAA",
          },
        })}
      />,
    );

    // The image is visible without expanding anything, and previews on click.
    const thumb = screen.getByRole("img", { name: "Generated image" }) as HTMLImageElement;
    expect(thumb.src).toBe("data:image/png;base64,AAAA");
    expect(screen.getByText("a red panda")).toBeDefined();

    // The expanded panel shows the call's metadata without the base64 payload.
    await user.click(screen.getByRole("button", { name: /generate image/i }));
    expect(screen.getByText(/"model": "fake:paint"/)).toBeDefined();
    expect(screen.queryByText(/base64,AAAA/)).toBeNull();
  });

  it("renders a plain JSON result for a generate_image output without an image", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={part({
          type: "tool-generate_image",
          state: "output-available",
          input: { prompt: "a red panda" },
          output: { note: "nothing came back" },
        })}
      />,
    );

    expect(screen.queryByRole("img")).toBeNull();
    await user.click(screen.getByRole("button", { name: /generate image/i }));
    expect(screen.getByText(/"note": "nothing came back"/)).toBeDefined();
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

  it("renders a project-instructions rewrite as a diff", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("update_project_instructions", {
          state: "output-available",
          input: { instructions_md: "new rule" },
          output: {
            project: "Research",
            instructions: "updated",
            diff: "@@ -1,1 +1,1 @@\n-old rule\n+new rule",
          },
        })}
      />,
    );

    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText("new rule").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
    expect(screen.queryByText(/"project"/)).toBeNull();
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

  it("renders a read file's content verbatim, with its truncation note", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("read_file", {
          state: "output-available",
          input: { path: "/ws/index.ts" },
          output: {
            path: "/ws/index.ts",
            content: 'const x = "one line";',
            note: "truncated — first 65536 bytes of 90000",
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    // Verbatim in a code block, not a JSON-escaped string.
    expect(screen.getByText('const x = "one line";')).toBeDefined();
    expect(screen.queryByText(/\\"one line\\"/)).toBeNull();
    expect(screen.getByText("truncated — first 65536 bytes of 90000")).toBeDefined();
  });

  it("renders a read article's markdown verbatim, never interpreted", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("read_article", {
          state: "output-available",
          input: { slug: "notes" },
          output: { slug: "notes", name: "Notes", content_md: "# Heading stays literal" },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    const body = screen.getByText("# Heading stays literal");
    expect(body.closest("pre")).not.toBeNull();
    expect(body.closest("h1")).toBeNull();
  });

  it("renders a skill's bare-string instructions verbatim", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("use_skill", {
          state: "output-available",
          input: { name: "workflow-authoring" },
          output: "Follow these steps.",
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Follow these steps.").closest("pre")).not.toBeNull();
  });

  it("falls back to JSON for a read result missing its body", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("read_memory", {
          state: "output-available",
          input: { name: "fact" },
          output: { name: "fact", deleted: true },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"deleted"/)).toBeDefined();
  });

  it("renders search matches as grep-style lines with the result's note", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("search_files", {
          state: "output-available",
          input: { pattern: "TODO" },
          output: {
            matches: [
              { file: "/ws/a.ts", line: 3, text: "// TODO: one" },
              { file: "/ws/b.ts", line: 9, text: "// TODO: two" },
            ],
            note: "stopped at 200 matches — tighten the pattern or include filter",
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/\/ws\/a\.ts:3: \/\/ TODO: one/)).toBeDefined();
    expect(
      screen.getByText("stopped at 200 matches — tighten the pattern or include filter"),
    ).toBeDefined();
    expect(screen.queryByText(/"matches"/)).toBeNull();
  });

  it("renders found files one per line, noting a capped result", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("find_files", {
          state: "output-available",
          input: { pattern: "**/*.md" },
          output: { files: ["/ws/README.md", "/ws/docs/setup.md"], capped: true },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/\/ws\/README\.md/).closest("pre")).not.toBeNull();
    expect(screen.getByText("capped — narrow the pattern or directory")).toBeDefined();
  });

  it("renders a directory listing one entry per line", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("list_directory", {
          state: "output-available",
          input: { path: "." },
          output: { path: "/ws", entries: ["docs/", "src/", "README.md"] },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/docs\//).closest("pre")).not.toBeNull();
    expect(screen.queryByText(/"entries"/)).toBeNull();
  });

  it("says so when a directory listing is empty", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("list_directory", {
          state: "output-available",
          input: { path: "empty" },
          output: { path: "/ws/empty", entries: [] },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("Empty directory.")).toBeDefined();
  });

  it("falls back to JSON for a malformed search result", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("search_files", {
          state: "output-available",
          input: { pattern: "TODO" },
          output: { matches: [{ file: "/ws/a.ts" }] },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"matches"/)).toBeDefined();
  });

  it("renders an article rewrite's server diff as toned rows", async () => {
    // replace_article's before-text only the server knows, so its result
    // carries the diff — same pipeline as the filesystem writes.
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("replace_article", {
          state: "output-available",
          input: { slug: "notes", content_md: "# New" },
          output: { slug: "notes", name: "Notes", diff: "@@ -1,1 +1,1 @@\n-# Old\n+# New" },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText("# Old").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("removed");
    expect(
      screen.getByText("# New").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
  });

  it("renders a settled article edit as a diff from its input", async () => {
    // The article and workflow edits carry no server diff — the old/new pair
    // in the input is the whole change.
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("edit_article", {
          state: "output-available",
          input: { slug: "release-notes", old_string: "shipped", new_string: "released" },
          output: { slug: "release-notes", replacements: 1 },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText("shipped").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("removed");
    expect(
      screen.getByText("released").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
    // The slug doubles as the collapsed summary detail.
    expect(screen.getByText("release-notes")).toBeDefined();
  });

  it("renders a created article's body as additions, from the call's input", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("create_article", {
          state: "output-available",
          input: { slug: "notes", name: "Notes", content_md: "fresh article line" },
          output: { slug: "notes", name: "Notes" },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen
        .getByText("fresh article line")
        .closest("[data-diff-line]")
        ?.getAttribute("data-diff-line"),
    ).toBe("added");
  });

  it("renders a created workflow's YAML as additions, from the call's input", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("create_workflow", {
          state: "output-available",
          input: { slug: "digest", content_yaml: "name: digest" },
          output: { name: "digest", file: "workflows/digest.yaml" },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(
      screen.getByText("name: digest").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
  });

  it("falls back to JSON for an article edit whose input lacks the old/new pair", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("edit_article", {
          state: "output-available",
          input: { slug: "notes" },
          output: { slug: "notes", replacements: 0 },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"replacements"/)).toBeDefined();
  });

  it("previews a workflow edit awaiting approval as a change, not JSON", () => {
    render(
      <ToolInvocation
        part={writePart("edit_workflow", {
          state: "approval-requested",
          input: { name: "digest", old_string: "cron: daily", new_string: "cron: weekly" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(
      screen.getByText("cron: daily").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("removed");
    expect(
      screen.getByText("cron: weekly").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
    ).toBe("added");
    expect(screen.queryByText(/"old_string"/)).toBeNull();
  });

  it("previews a workflow creation awaiting approval as its YAML added", () => {
    render(
      <ToolInvocation
        part={writePart("create_workflow", {
          state: "approval-requested",
          input: { slug: "digest", content_yaml: "name: digest" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(
      screen.getByText("name: digest").closest("[data-diff-line]")?.getAttribute("data-diff-line"),
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

  it("shows the command in the collapsed summary for shell calls", () => {
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "output-available",
          input: { command: "bun test" },
          output: { cwd: "/ws", exitCode: 0, stdout: "", stderr: "", durationMs: 12 },
        })}
      />,
    );
    expect(screen.getByText("bun test")).toBeDefined();
  });

  it("previews a shell command awaiting approval verbatim, with its directory", () => {
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "approval-requested",
          input: { command: "git status", cwd: "/ws/app" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    // The command itself is the preview — shown verbatim, not as JSON — and
    // the summary row carries it too.
    expect(screen.getAllByText("git status").length).toBeGreaterThan(0);
    expect(screen.getByText("in /ws/app")).toBeDefined();
    expect(screen.queryByText(/"command"/)).toBeNull();
  });

  it("falls back to the JSON input for a malformed shell approval", () => {
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "approval-requested",
          input: { cwd: "/ws/app" },
          approval: { id: "a1" },
        })}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText(/"cwd": "\/ws\/app"/)).toBeDefined();
  });

  it("renders a shell result as exit status and output streams, not JSON", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "output-available",
          input: { command: "bun test" },
          output: {
            cwd: "/ws",
            exitCode: 1,
            stdout: "1 fail\n",
            stderr: "boom\n",
            durationMs: 42,
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("exited 1 · 42 ms")).toBeDefined();
    expect(screen.getByText(/1 fail/)).toBeDefined();
    expect(screen.getByText("stderr")).toBeDefined();
    expect(screen.getByText(/boom/)).toBeDefined();
    expect(screen.queryByText(/"exitCode"/)).toBeNull();
  });

  it("reports a timed-out command as killed, with truncated tails flagged", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "output-available",
          input: { command: "bun test" },
          output: {
            cwd: "/ws",
            exitCode: null,
            stdout: "tail of output",
            stderr: "",
            durationMs: 120000,
            timedOut: true,
            stdoutTruncated: true,
          },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("killed at its timeout · 120000 ms")).toBeDefined();
    expect(screen.getByText(/\[truncated — tail shown\]/)).toBeDefined();
  });

  it("says so when a command produced no output", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "output-available",
          input: { command: "true" },
          output: { cwd: "/ws", exitCode: 0, stdout: "", stderr: "", durationMs: 3 },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("exited 0 · 3 ms")).toBeDefined();
    expect(screen.getByText("No output.")).toBeDefined();
  });

  it("falls back to JSON for a shell result missing its streams", async () => {
    const user = userEvent.setup();
    render(
      <ToolInvocation
        part={writePart("run_command", {
          state: "output-available",
          input: { command: "true" },
          output: { unexpected: true },
        })}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(/"unexpected": true/)).toBeDefined();
  });
});
