import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import type { WorkflowSummary } from "../api.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { WorkflowDetailView } from "./workflow-detail.tsx";

const stubWorkflow = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "kiri-self-review",
  steps: [{ sh: "echo hello" }],
  ...overrides,
});

const renderDetail = async (
  workflow: WorkflowSummary,
  onTrigger: (name: string) => Promise<unknown> = () => Promise.resolve({}),
  tab?: string,
) => {
  const search = tab ? `?tab=${tab}` : "";
  const { hook } = memoryLocation({ path: `/workflows/${workflow.name}${search}` });
  const { factory } = captureEventSources();
  const result = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <WorkflowDetailView workflow={workflow} onTrigger={onTrigger} />
      </LiveEventsProvider>
    </Router>,
  );
  // Settle the hero panels' on-mount fetches inside act() so a spec that
  // asserts synchronously doesn't leave a setState to land outside act.
  await flushAsync();
  return result;
};

describe("<WorkflowDetailView>", () => {
  describe("hero", () => {
    it("renders the workflow name as a level-2 heading", async () => {
      await renderDetail(stubWorkflow({ name: "pr-review" }));
      expect(screen.getByRole("heading", { level: 2, name: /pr-review/i })).toBeDefined();
    });

    it("keeps the full workflow name as the title when a group is set", async () => {
      await renderDetail(stubWorkflow({ name: "patch", group: "Dev" }));
      expect(screen.getByRole("heading", { level: 2, name: "patch" })).toBeDefined();
    });

    it("renders the back link to the activity feed", async () => {
      await renderDetail(stubWorkflow());
      const link = screen.getByRole("link", { name: /all activity/i });
      expect(link.getAttribute("href")).toBe("/");
    });

    it("renders a static eyebrow when the workflow has no group", async () => {
      await renderDetail(stubWorkflow());
      expect(screen.getByText("Workflow")).toBeDefined();
    });

    it("renders the group in the eyebrow when one is set", async () => {
      await renderDetail(stubWorkflow({ group: "Dev" }));
      expect(screen.getByText("Dev · Workflow")).toBeDefined();
    });

    it("renders the description as the deck when present", async () => {
      await renderDetail(stubWorkflow({ description: "Patches Dependabot alerts." }));
      expect(screen.getByText("Patches Dependabot alerts.")).toBeDefined();
    });

    it("omits the deck when no description is declared", async () => {
      await renderDetail(stubWorkflow());
      expect(screen.queryByText("Patches Dependabot alerts.")).toBeNull();
    });

    it("labels the run button 'run with inputs' when the workflow declares inputs", async () => {
      await renderDetail(stubWorkflow({ inputs: [{ name: "pr_number", required: true }] }));
      expect(screen.getByRole("button", { name: "run with inputs" })).toBeDefined();
    });

    it("labels the run button 'run' when the workflow declares no inputs", async () => {
      await renderDetail(stubWorkflow());
      expect(screen.getByRole("button", { name: "run" })).toBeDefined();
    });
  });

  describe("stats panel", () => {
    it("mounts the Last 14 runs panel between the hero and the tabs", async () => {
      await renderDetail(stubWorkflow());
      expect(screen.getByRole("heading", { name: /last 14 runs/i })).toBeDefined();
    });
  });

  describe("tabs", () => {
    it("opens on the Recent runs tab by default", async () => {
      await renderDetail(stubWorkflow());
      expect(screen.getByRole("tab", { name: "Recent runs", selected: true })).toBeDefined();
      // The default panel hosts the recent-runs feed, which settles on its
      // empty state for a workflow with no runs.
      expect(await screen.findByText(/no runs yet/i)).toBeDefined();
    });
  });

  describe("inputs tab", () => {
    it("renders an empty state when the workflow declares no inputs", async () => {
      await renderDetail(stubWorkflow(), undefined, "inputs");
      expect(screen.getByText(/declares no inputs/i)).toBeDefined();
    });

    it("renders one row per declared input with its name", async () => {
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "repo", required: true }, { name: "model" }],
        }),
        undefined,
        "inputs",
      );
      expect(screen.getByText("repo")).toBeDefined();
      expect(screen.getByText("model")).toBeDefined();
    });

    it("marks a required input as required and an optional one as opt", async () => {
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "repo", required: true }, { name: "model" }],
        }),
        undefined,
        "inputs",
      );
      expect(screen.getByText("required")).toBeDefined();
      expect(screen.getByText("opt")).toBeDefined();
    });

    it("renders the derived type as enum for a picklist input and string otherwise", async () => {
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "env", options: ["dev", "prod"] }, { name: "model" }],
        }),
        undefined,
        "inputs",
      );
      expect(screen.getByText("enum")).toBeDefined();
      expect(screen.getByText("string")).toBeDefined();
    });

    it("renders the default value when one is declared", async () => {
      await renderDetail(
        stubWorkflow({ inputs: [{ name: "model", default: "sonnet" }] }),
        undefined,
        "inputs",
      );
      expect(screen.getByText("sonnet")).toBeDefined();
    });

    it("renders the description when one is declared", async () => {
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "repo", description: "owner/name of the repository" }],
        }),
        undefined,
        "inputs",
      );
      expect(screen.getByText("owner/name of the repository")).toBeDefined();
    });
  });

  describe("steps tab", () => {
    it("renders an empty state when the workflow declares no steps", async () => {
      await renderDetail(stubWorkflow({ steps: [] }), undefined, "steps");
      expect(screen.getByText(/declares no steps/i)).toBeDefined();
    });

    it("numbers steps with a two-digit ordinal in declared order", async () => {
      await renderDetail(
        stubWorkflow({ steps: [{ use: "claude-code" }, { sh: "echo done" }] }),
        undefined,
        "steps",
      );
      expect(screen.getByText("01")).toBeDefined();
      expect(screen.getByText("02")).toBeDefined();
    });

    it("renders a use: step as kind use with the bundle reference as the title", async () => {
      await renderDetail(stubWorkflow({ steps: [{ use: "claude-code" }] }), undefined, "steps");
      expect(screen.getByText("use")).toBeDefined();
      expect(screen.getByText("claude-code")).toBeDefined();
    });

    it("renders an sh: step as kind sh with the first non-empty line as the title", async () => {
      await renderDetail(
        stubWorkflow({ steps: [{ sh: "\n\n  echo hello\nexit 0" }] }),
        undefined,
        "steps",
      );
      expect(screen.getByText("sh")).toBeDefined();
      expect(screen.getByText("echo hello")).toBeDefined();
    });

    it("truncates a long sh: title", async () => {
      await renderDetail(stubWorkflow({ steps: [{ sh: "a".repeat(80) }] }), undefined, "steps");
      expect(screen.getByText(/^a{60}…$/)).toBeDefined();
    });

    it("renders the step description when set", async () => {
      await renderDetail(
        stubWorkflow({ steps: [{ use: "claude-code", description: "review the open PR" }] }),
        undefined,
        "steps",
      );
      expect(screen.getByText("review the open PR")).toBeDefined();
    });

    it("omits the description block when a step declares none", async () => {
      await renderDetail(stubWorkflow({ steps: [{ use: "claude-code" }] }), undefined, "steps");
      expect(screen.queryByText(/^description$/i)).toBeNull();
    });

    it("renders the inline source for an sh: step", async () => {
      await renderDetail(
        stubWorkflow({ steps: [{ sh: "echo materials\nexit 0" }] }),
        undefined,
        "steps",
      );
      const sourcePanel = screen.getByText(/^source$/i).parentElement;
      expect(sourcePanel?.textContent).toContain("echo materials");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders the env block for a step that declares env", async () => {
      await renderDetail(
        stubWorkflow({ steps: [{ use: "claude-code", env: { MODEL: "sonnet" } }] }),
        undefined,
        "steps",
      );
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("MODEL")).toBeDefined();
      expect(screen.getByText("sonnet")).toBeDefined();
    });
  });

  describe("source panel", () => {
    it("shows a short sh: source in full with no expand toggle", async () => {
      await renderDetail(stubWorkflow({ steps: [{ sh: "echo hi\nexit 0" }] }), undefined, "steps");
      expect(screen.queryByRole("button", { name: /expand|collapse/i })).toBeNull();
    });

    it("collapses a long sh: source behind a toggle that expands and re-collapses", async () => {
      const user = userEvent.setup();
      const longSource = Array.from({ length: 20 }, (_, i) => `echo line ${i}`).join("\n");
      await renderDetail(stubWorkflow({ steps: [{ sh: longSource }] }), undefined, "steps");

      await user.click(screen.getByRole("button", { name: "expand" }));
      expect(screen.getByRole("button", { name: "collapse" })).toBeDefined();

      await user.click(screen.getByRole("button", { name: "collapse" }));
      expect(screen.getByRole("button", { name: "expand" })).toBeDefined();
    });
  });

  describe("summariser tab", () => {
    it("renders an empty state when the workflow has no summariser", async () => {
      await renderDetail(stubWorkflow(), undefined, "summariser");
      expect(screen.getByText(/no summariser configured/i)).toBeDefined();
    });

    it("renders a use: summariser as kind use with the bundle reference as the title", async () => {
      await renderDetail(
        stubWorkflow({ summarize: { use: "claude-code-summarizer" } }),
        undefined,
        "summariser",
      );
      expect(screen.getByText("use")).toBeDefined();
      expect(screen.getByText("claude-code-summarizer")).toBeDefined();
    });

    it("renders an sh: summariser as kind sh with the first non-empty line as the title", async () => {
      await renderDetail(
        stubWorkflow({ summarize: { sh: "\necho summarising\nexit 0" } }),
        undefined,
        "summariser",
      );
      expect(screen.getByText("sh")).toBeDefined();
      expect(screen.getByText("echo summarising")).toBeDefined();
    });

    it("renders the inline source for an sh: summariser", async () => {
      await renderDetail(
        stubWorkflow({ summarize: { sh: "echo summarising\nexit 0" } }),
        undefined,
        "summariser",
      );
      const sourcePanel = screen.getByText(/^source$/i).parentElement;
      expect(sourcePanel?.textContent).toContain("echo summarising");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders the summariser description when set", async () => {
      await renderDetail(
        stubWorkflow({
          summarize: { use: "claude-code-summarizer", description: "one-line digest of the run" },
        }),
        undefined,
        "summariser",
      );
      expect(screen.getByText("one-line digest of the run")).toBeDefined();
    });

    it("renders the env map with input references in YAML ref form", async () => {
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "model", default: "sonnet" }],
          summarize: {
            use: "claude-code-summarizer",
            env: { MODEL: { input: "model" }, PROMPT: "summarise" },
          },
        }),
        undefined,
        "summariser",
      );
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("MODEL")).toBeDefined();
      expect(screen.getByText("{ input: model }")).toBeDefined();
      expect(screen.getByText("PROMPT")).toBeDefined();
      expect(screen.getByText("summarise")).toBeDefined();
    });

    it("omits the env block when the summariser declares no env", async () => {
      await renderDetail(
        stubWorkflow({ summarize: { use: "claude-code-summarizer" } }),
        undefined,
        "summariser",
      );
      expect(screen.queryByText(/^env$/i)).toBeNull();
    });
  });

  describe("publishes tab", () => {
    it("renders an empty state when the workflow publishes nothing", async () => {
      await renderDetail(stubWorkflow(), undefined, "publishes");
      expect(screen.getByText(/publishes no articles/i)).toBeDefined();
    });

    it("renders a row per entry with its title, name, kind, and source reference", async () => {
      await renderDetail(
        stubWorkflow({
          publish: [{ name: "pr-digest", title: "PR Digest", use: "claude-code" }],
        }),
        undefined,
        "publishes",
      );
      expect(screen.getByRole("heading", { level: 4, name: "PR Digest" })).toBeDefined();
      expect(screen.getByText("pr-digest")).toBeDefined();
      expect(screen.getByText("use")).toBeDefined();
      expect(screen.getByText("claude-code")).toBeDefined();
    });

    it("renders the inline source for an sh: publish entry", async () => {
      await renderDetail(
        stubWorkflow({
          publish: [{ name: "report", title: "Report", sh: "echo body\nexit 0" }],
        }),
        undefined,
        "publishes",
      );
      const sourcePanel = screen.getByText(/^source$/i).parentElement;
      expect(sourcePanel?.textContent).toContain("echo body");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders the description and env blocks when an entry declares them", async () => {
      await renderDetail(
        stubWorkflow({
          publish: [
            {
              name: "digest",
              title: "Digest",
              description: "a long-form summary of the top stories",
              use: "claude-code",
              env: { MODEL: "sonnet" },
            },
          ],
        }),
        undefined,
        "publishes",
      );
      expect(screen.getByText("a long-form summary of the top stories")).toBeDefined();
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("MODEL")).toBeDefined();
      expect(screen.getByText("sonnet")).toBeDefined();
    });
  });

  describe("trigger", () => {
    it("calls onTrigger with just the workflow name when the workflow has no inputs", async () => {
      const user = userEvent.setup();
      const onTrigger = mock(() => Promise.resolve({}));
      await renderDetail(stubWorkflow({ name: "pr-review" }), onTrigger);
      await user.click(screen.getByRole("button", { name: /run/i }));
      expect(onTrigger).toHaveBeenCalledWith("pr-review");
    });

    it("shows a running indicator while the trigger is in flight", async () => {
      const user = userEvent.setup();
      let resolve: ((value: unknown) => void) | undefined;
      const onTrigger = () =>
        new Promise<unknown>((r) => {
          resolve = r;
        });
      await renderDetail(stubWorkflow(), onTrigger);

      await user.click(screen.getByRole("button", { name: /run/i }));
      expect(screen.getByRole("button", { name: /running/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /running/i }).hasAttribute("disabled")).toBe(true);

      resolve?.({});
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^run/i })).toBeDefined();
      });
    });

    it("surfaces a trigger error inline and re-enables the button", async () => {
      const user = userEvent.setup();
      const onTrigger = () => Promise.reject(new Error("kaboom"));
      await renderDetail(stubWorkflow(), onTrigger);

      await user.click(screen.getByRole("button", { name: /run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("kaboom");
      expect(screen.getByRole("button", { name: /^run/i }).hasAttribute("disabled")).toBe(false);
    });

    it("falls back to a generic error message when the rejection isn't an Error", async () => {
      const user = userEvent.setup();
      const onTrigger = () => Promise.reject("not an Error instance");
      await renderDetail(stubWorkflow(), onTrigger);

      await user.click(screen.getByRole("button", { name: /run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/trigger failed/i);
    });
  });

  describe("trigger with inputs", () => {
    it("opens the invoke modal on click instead of triggering immediately", async () => {
      const user = userEvent.setup();
      const onTrigger = mock(() => Promise.resolve({}));
      await renderDetail(
        stubWorkflow({
          name: "pr-review",
          inputs: [{ name: "pr_number", required: true }],
        }),
        onTrigger,
      );

      expect(screen.queryByRole("dialog")).toBeNull();
      await user.click(screen.getByRole("button", { name: /run/i }));

      // Modal opens; onTrigger is not called until the user submits.
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it("submits the modal values to onTrigger and lands on the run", async () => {
      const user = userEvent.setup();
      const seen: Array<[string, Record<string, string> | undefined]> = [];
      const onTrigger = (name: string, inputs?: Record<string, string>) => {
        seen.push([name, inputs]);
        return Promise.resolve({});
      };
      await renderDetail(
        stubWorkflow({
          name: "pr-review",
          inputs: [
            { name: "pr_number", required: true },
            { name: "branch", default: "main" },
          ],
        }),
        onTrigger,
      );

      await user.click(screen.getByRole("button", { name: /^run/i }));
      await user.type(screen.getByLabelText(/pr_number/i), "42");
      await user.click(screen.getAllByRole("button", { name: /^run/i }).at(-1) as HTMLElement);

      expect(seen).toEqual([["pr-review", { pr_number: "42", branch: "main" }]]);
    });

    it("closes the modal without invoking onTrigger when the user cancels", async () => {
      const user = userEvent.setup();
      const onTrigger = mock(() => Promise.resolve({}));
      await renderDetail(
        stubWorkflow({
          inputs: [{ name: "pr_number", required: true }],
        }),
        onTrigger,
      );

      await user.click(screen.getByRole("button", { name: /^run/i }));
      expect(screen.getByRole("dialog")).toBeDefined();

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(onTrigger).not.toHaveBeenCalled();
    });
  });
});
