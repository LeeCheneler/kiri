import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { WorkflowSummary } from "../api.ts";
import { WorkflowDetailView } from "./workflow-detail.tsx";

afterEach(() => cleanup());

const stubWorkflow = (overrides: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  name: "kiri-self-review",
  steps: [{ sh: "echo hello" }],
  ...overrides,
});

const renderDetail = (
  workflow: WorkflowSummary,
  onTrigger: (name: string) => Promise<unknown> = () => Promise.resolve({}),
) => {
  const { hook } = memoryLocation({ path: `/workflows/${workflow.name}` });
  return render(
    <Router hook={hook}>
      <WorkflowDetailView workflow={workflow} onTrigger={onTrigger} />
    </Router>,
  );
};

describe("<WorkflowDetailView>", () => {
  describe("header", () => {
    it("renders the workflow name as a level-2 heading", () => {
      renderDetail(stubWorkflow({ name: "pr-review" }));
      expect(screen.getByRole("heading", { level: 2, name: /pr-review/i })).toBeDefined();
    });

    it("renders the back link to the activity feed", () => {
      renderDetail(stubWorkflow());
      const link = screen.getByRole("link", { name: /all activity/i });
      expect(link.getAttribute("href")).toBe("/");
    });

    it("renders the singular step count when there is exactly one step", () => {
      renderDetail(stubWorkflow({ steps: [{ sh: "echo one" }] }));
      // Both header dl and section header carry the count.
      expect(screen.getAllByText(/^1 step$/i).length).toBeGreaterThan(0);
    });

    it("renders the plural step count for multi-step workflows", () => {
      renderDetail(
        stubWorkflow({
          steps: [{ sh: "echo a" }, { sh: "echo b" }, { sh: "echo c" }],
        }),
      );
      expect(screen.getAllByText(/^3 steps$/i).length).toBeGreaterThan(0);
    });

    it("renders gating when the workflow declares it", () => {
      renderDetail(stubWorkflow({ gating: "auto" }));
      expect(screen.getByText(/gating: auto/i)).toBeDefined();
    });

    it("omits gating when the workflow does not declare it", () => {
      renderDetail(stubWorkflow({ gating: undefined }));
      expect(screen.queryByText(/gating:/i)).toBeNull();
    });

    it("renders the schedule expression in italic when present", () => {
      renderDetail(stubWorkflow({ schedule: "*/15 * * * *" }));
      const cron = screen.getByText("*/15 * * * *");
      expect(cron.className).toContain("italic");
    });

    it("omits the schedule slot when the workflow has no schedule", () => {
      renderDetail(stubWorkflow({ schedule: undefined }));
      expect(screen.queryByText(/\*/)).toBeNull();
    });

    it("surfaces the artefact count in the header when the workflow publishes", () => {
      renderDetail(
        stubWorkflow({
          publish: [{ name: "digest", title: "Digest", use: "claude-code" }],
        }),
      );
      // Both the header dl and the publish section header carry the count.
      expect(screen.getAllByText(/^1 artefact$/i).length).toBeGreaterThan(0);
    });

    it("omits the artefact slot when the workflow has no publish entries", () => {
      renderDetail(stubWorkflow());
      expect(screen.queryByText(/artefact/i)).toBeNull();
    });

    it("surfaces a 'summarised' indicator in the header when the workflow summarises", () => {
      renderDetail(stubWorkflow({ summarize: { use: "claude-code-summarizer" } }));
      expect(screen.getByText(/^summarised$/i)).toBeDefined();
    });

    it("omits the summariser indicator when the workflow has no summarize step", () => {
      renderDetail(stubWorkflow());
      expect(screen.queryByText(/^summarised$/i)).toBeNull();
    });
  });

  describe("steps", () => {
    it("renders an empty-state sentence when no steps are defined", () => {
      renderDetail(stubWorkflow({ steps: [] }));
      expect(screen.getByText(/no steps defined/i)).toBeDefined();
    });

    it("renders the step number padded to two digits", () => {
      renderDetail(stubWorkflow({ steps: [{ sh: "echo hi" }] }));
      expect(screen.getByText("01")).toBeDefined();
    });

    it("labels a use: step with the bundle name", () => {
      renderDetail(stubWorkflow({ steps: [{ use: "claude-code" }] }));
      expect(screen.getByText("use: claude-code")).toBeDefined();
    });

    it("labels a sh: step with the first line of the source", () => {
      renderDetail(stubWorkflow({ steps: [{ sh: "echo hello\nexit 0" }] }));
      expect(screen.getByText(/^sh: echo hello$/)).toBeDefined();
    });

    it("truncates long sh: labels", () => {
      const longLine = "a".repeat(80);
      renderDetail(stubWorkflow({ steps: [{ sh: longLine }] }));
      // 60-char truncation + ellipsis.
      expect(screen.getByText(/^sh: a{60}…$/)).toBeDefined();
    });

    it("renders the inline source for sh: steps", () => {
      renderDetail(stubWorkflow({ steps: [{ sh: "echo materials body\nexit 0" }] }));
      const sourceHeading = screen.getByText(/^source$/i);
      const sourcePanel = sourceHeading.parentElement;
      expect(sourcePanel?.textContent).toContain("echo materials body");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders an env block for use: steps that declare env", () => {
      renderDetail(
        stubWorkflow({
          steps: [{ use: "claude-code", env: { PROMPT_FILE: "prompts/x.tpl", MAX_TURNS: "8" } }],
        }),
      );
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("PROMPT_FILE")).toBeDefined();
      expect(screen.getByText("prompts/x.tpl")).toBeDefined();
      expect(screen.getByText("MAX_TURNS")).toBeDefined();
      expect(screen.getByText("8")).toBeDefined();
    });

    it("sorts env keys alphabetically", () => {
      const { container } = renderDetail(
        stubWorkflow({
          steps: [{ use: "claude-code", env: { ZED: "z", ALPHA: "a", MID: "m" } }],
        }),
      );
      const keys = Array.from(container.querySelectorAll("dt"))
        .map((dt) => dt.textContent)
        .filter((label) => label && /^[A-Z]/.test(label));
      expect(keys).toEqual(["ALPHA", "MID", "ZED"]);
    });

    it("omits the env block when a use: step has no env map", () => {
      renderDetail(stubWorkflow({ steps: [{ use: "claude-code" }] }));
      expect(screen.queryByText(/^env$/i)).toBeNull();
    });

    it("omits the env block when a use: step's env is empty", () => {
      renderDetail(stubWorkflow({ steps: [{ use: "claude-code", env: {} }] }));
      expect(screen.queryByText(/^env$/i)).toBeNull();
    });

    it("renders both source and env for sh: steps that declare env", () => {
      renderDetail(
        stubWorkflow({
          steps: [{ sh: "echo $GREETING", env: { GREETING: "hi" } }],
        }),
      );
      expect(screen.getByText(/^source$/i)).toBeDefined();
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("GREETING")).toBeDefined();
    });

    it("renders the description block when a step declares one", () => {
      renderDetail(
        stubWorkflow({
          steps: [{ use: "claude-code", description: "review the open PR" }],
        }),
      );
      expect(screen.getByText(/^description$/i)).toBeDefined();
      expect(screen.getByText("review the open PR")).toBeDefined();
    });

    it("omits the description block when a step has no description", () => {
      renderDetail(stubWorkflow({ steps: [{ use: "claude-code" }] }));
      expect(screen.queryByText(/^description$/i)).toBeNull();
    });
  });

  describe("publish", () => {
    it("does not render the publish section when the workflow has no publish entries", () => {
      renderDetail(stubWorkflow());
      expect(screen.queryByRole("heading", { level: 3, name: /^publish$/i })).toBeNull();
    });

    it("renders the publish section with a heading and per-entry rows for use: entries", () => {
      renderDetail(
        stubWorkflow({
          publish: [
            { name: "pr-digest", title: "PR Digest", use: "claude-code" },
            { name: "weekly-report", title: "Weekly Report", use: "claude-code" },
          ],
        }),
      );
      expect(screen.getByRole("heading", { level: 3, name: /^publish$/i })).toBeDefined();
      expect(screen.getByRole("heading", { level: 4, name: /^PR Digest$/ })).toBeDefined();
      expect(screen.getByRole("heading", { level: 4, name: /^Weekly Report$/ })).toBeDefined();
      // Both entries surface their source label and keyed kebab-case name.
      expect(screen.getAllByText(/^use: claude-code$/)).toHaveLength(2);
      expect(screen.getByText(/^name: pr-digest$/)).toBeDefined();
      expect(screen.getByText(/^name: weekly-report$/)).toBeDefined();
    });

    it("renders the truncated first line of an sh: publish entry as its source label", () => {
      renderDetail(
        stubWorkflow({
          publish: [{ name: "report", title: "Report", sh: "echo line 1\nexit 0" }],
        }),
      );
      expect(screen.getByText(/^sh: echo line 1$/)).toBeDefined();
    });

    it("shows the singular artefact count for a single publish entry", () => {
      renderDetail(
        stubWorkflow({
          publish: [{ name: "digest", title: "Digest", use: "claude-code" }],
        }),
      );
      // Header summary + publish section header both surface the count.
      expect(screen.getAllByText(/^1 artefact$/).length).toBeGreaterThan(0);
    });

    it("shows the plural artefact count for multiple publish entries", () => {
      renderDetail(
        stubWorkflow({
          publish: [
            { name: "a", title: "A", sh: "echo a" },
            { name: "b", title: "B", sh: "echo b" },
            { name: "c", title: "C", sh: "echo c" },
          ],
        }),
      );
      expect(screen.getAllByText(/^3 artefacts$/).length).toBeGreaterThan(0);
    });

    it("renders inline source for sh: publish entries", () => {
      renderDetail(
        stubWorkflow({
          // Override the default sh: step so the only "source" block on
          // screen is the one under the publish entry.
          steps: [{ use: "noop" }],
          publish: [{ name: "report", title: "Report", sh: "echo body\nexit 0" }],
        }),
      );
      const sourceHeading = screen.getByText(/^source$/i);
      const sourcePanel = sourceHeading.parentElement;
      expect(sourcePanel?.textContent).toContain("echo body");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders the env block for publish entries that declare env", () => {
      renderDetail(
        stubWorkflow({
          publish: [
            {
              name: "digest",
              title: "Digest",
              use: "claude-code",
              env: { PROMPT_FILE: "prompts/x.tpl", MODEL: "sonnet" },
            },
          ],
        }),
      );
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("PROMPT_FILE")).toBeDefined();
      expect(screen.getByText("prompts/x.tpl")).toBeDefined();
      expect(screen.getByText("MODEL")).toBeDefined();
      expect(screen.getByText("sonnet")).toBeDefined();
    });

    it("renders the description block when a publish entry declares one", () => {
      renderDetail(
        stubWorkflow({
          publish: [
            {
              name: "digest",
              title: "Digest",
              description: "a long-form summary of the top stories",
              use: "claude-code",
            },
          ],
        }),
      );
      expect(screen.getByText(/^description$/i)).toBeDefined();
      expect(screen.getByText("a long-form summary of the top stories")).toBeDefined();
    });
  });

  describe("summarise", () => {
    it("does not render the summarise section when the workflow has no summarize step", () => {
      renderDetail(stubWorkflow());
      expect(screen.queryByRole("heading", { level: 3, name: /^summarise$/i })).toBeNull();
    });

    it("renders the summarise section with the use: source label", () => {
      renderDetail(stubWorkflow({ summarize: { use: "claude-code-summarizer" } }));
      expect(screen.getByRole("heading", { level: 3, name: /^summarise$/i })).toBeDefined();
      expect(screen.getByText(/^use: claude-code-summarizer$/)).toBeDefined();
    });

    it("renders the summarise section with the truncated first line of an sh: step", () => {
      renderDetail(stubWorkflow({ summarize: { sh: "echo summarising\nexit 0" } }));
      expect(screen.getByRole("heading", { level: 3, name: /^summarise$/i })).toBeDefined();
      expect(screen.getByText(/^sh: echo summarising$/)).toBeDefined();
    });

    it("renders inline source for an sh: summariser", () => {
      renderDetail(
        stubWorkflow({
          // Override the default sh: step so the only "source" block on
          // screen is the summariser's.
          steps: [{ use: "noop" }],
          summarize: { sh: "echo summarising\nexit 0" },
        }),
      );
      const sourceHeading = screen.getByText(/^source$/i);
      const sourcePanel = sourceHeading.parentElement;
      expect(sourcePanel?.textContent).toContain("echo summarising");
      expect(sourcePanel?.textContent).toContain("exit 0");
    });

    it("renders the env block for a summariser that declares env", () => {
      renderDetail(
        stubWorkflow({
          summarize: {
            use: "claude-code-summarizer",
            env: { MODEL: "haiku", PROMPT: "summarise" },
          },
        }),
      );
      expect(screen.getByText(/^env$/i)).toBeDefined();
      expect(screen.getByText("MODEL")).toBeDefined();
      expect(screen.getByText("haiku")).toBeDefined();
      expect(screen.getByText("PROMPT")).toBeDefined();
    });

    it("renders the description block when the summariser declares one", () => {
      renderDetail(
        stubWorkflow({
          summarize: {
            use: "claude-code-summarizer",
            description: "one-line digest of the run",
          },
        }),
      );
      expect(screen.getByText(/^description$/i)).toBeDefined();
      expect(screen.getByText("one-line digest of the run")).toBeDefined();
    });
  });

  describe("trigger", () => {
    it("calls onTrigger with the workflow name on click", () => {
      const onTrigger = mock(() => Promise.resolve({}));
      renderDetail(stubWorkflow({ name: "pr-review" }), onTrigger);
      fireEvent.click(screen.getByRole("button", { name: /run/i }));
      expect(onTrigger).toHaveBeenCalledWith("pr-review");
    });

    it("shows a running indicator while the trigger is in flight", async () => {
      let resolve: ((value: unknown) => void) | undefined;
      const onTrigger = () =>
        new Promise<unknown>((r) => {
          resolve = r;
        });
      renderDetail(stubWorkflow(), onTrigger);

      fireEvent.click(screen.getByRole("button", { name: /run/i }));
      expect(screen.getByRole("button", { name: /running/i })).toBeDefined();
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

      await act(async () => {
        resolve?.({});
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^run/i })).toBeDefined();
      });
    });

    it("surfaces a trigger error inline and re-enables the button", async () => {
      const onTrigger = () => Promise.reject(new Error("kaboom"));
      renderDetail(stubWorkflow(), onTrigger);

      fireEvent.click(screen.getByRole("button", { name: /run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("kaboom");
      expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
    });

    it("falls back to a generic error message when the rejection isn't an Error", async () => {
      const onTrigger = () => Promise.reject("not an Error instance");
      renderDetail(stubWorkflow(), onTrigger);

      fireEvent.click(screen.getByRole("button", { name: /run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toMatch(/trigger failed/i);
    });
  });
});
