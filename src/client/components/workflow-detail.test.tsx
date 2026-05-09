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
