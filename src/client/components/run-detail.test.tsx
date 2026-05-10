import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RunDetail, RunListEntry, RunStepRow } from "../api.ts";
import { RunDetailView } from "./run-detail.tsx";

afterEach(() => cleanup());

const NOW = new Date("2026-05-09T12:00:00.000Z");

const stubRun = (overrides: Partial<RunListEntry> = {}): RunListEntry => ({
  id: "run-1",
  workflowName: "kiri-self-review",
  status: "ok",
  trigger: "manual",
  startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
  finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
  error: null,
  definitionSnapshot: { name: "kiri-self-review", steps: [] },
  isOrphan: false,
  ...overrides,
});

const stubStep = (overrides: Partial<RunStepRow> = {}): RunStepRow => ({
  id: "step-1",
  runId: "run-1",
  index: 0,
  kind: "sh",
  status: "ok",
  output: null,
  error: null,
  traces: { stdout: "hello, world", stderr: "", durationMs: 1_400 },
  usage: null,
  materials: { kind: "sh", source: "echo hello, world" },
  ...overrides,
});

const stubDetail = (run: Partial<RunListEntry> = {}, steps: RunStepRow[] = []): RunDetail => ({
  run: stubRun(run),
  steps,
});

const renderDetail = (detail: RunDetail, opts: { onCancel?: () => Promise<unknown> } = {}) => {
  const { hook } = memoryLocation({ path: `/runs/${detail.run.id}` });
  return render(
    <Router hook={hook}>
      <RunDetailView detail={detail} now={NOW} onCancel={opts.onCancel} />
    </Router>,
  );
};

describe("<RunDetailView>", () => {
  describe("header", () => {
    it("renders the workflow name as a level-2 heading", () => {
      renderDetail(stubDetail({ workflowName: "pr-review" }));
      expect(screen.getByRole("heading", { level: 2, name: /pr-review/i })).toBeDefined();
    });

    it("renders the status word in the matching status colour", () => {
      const { container } = renderDetail(stubDetail({ status: "failed" }));
      const status = container.querySelector('[data-status="failed"]');
      expect(status?.textContent).toBe("failed");
      expect(status?.className).toContain("text-status-failed");
    });

    it("renders cancelled runs with the cancelled status colour", () => {
      const { container } = renderDetail(stubDetail({ status: "cancelled" }));
      const status = container.querySelector('[data-status="cancelled"]');
      expect(status?.textContent).toBe("cancelled");
      expect(status?.className).toContain("text-status-cancelled");
    });

    it("renders the trigger, relative start time and duration in the metadata row", () => {
      renderDetail(
        stubDetail({
          trigger: "scheduled",
          startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
          finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
        }),
      );

      expect(screen.getByText(/scheduled/i)).toBeDefined();
      expect(screen.getByText(/3 minutes ago/i)).toBeDefined();
      expect(screen.getByText("12s")).toBeDefined();
    });

    it("attaches the absolute timestamp to the relative time as a title for hover", () => {
      const startedAt = new Date(NOW.getTime() - 3 * 60 * 1000).toISOString();
      renderDetail(stubDetail({ startedAt }));
      const time = screen.getByText(/3 minutes ago/i);
      expect(time.getAttribute("title")).toBe(startedAt);
    });

    it("renders an in-flight indicator instead of a duration when the run hasn't finished", () => {
      renderDetail(stubDetail({ status: "running", finishedAt: null }));
      expect(screen.getByText(/in flight/i)).toBeDefined();
    });

    it("renders the back link to the activity feed", () => {
      renderDetail(stubDetail());
      const link = screen.getByRole("link", { name: /all activity/i });
      expect(link.getAttribute("href")).toBe("/");
    });
  });

  describe("orphaned runs", () => {
    it("overrides the status to 'interrupted' when the workflow no longer exists", () => {
      const { container } = renderDetail(stubDetail({ status: "ok", isOrphan: true }));
      const status = container.querySelector('[data-status="interrupted"]');
      expect(status?.textContent).toBe("interrupted");
      expect(status?.className).toContain("text-status-interrupted");
    });

    it("appends a (deleted) marker after the workflow name", () => {
      renderDetail(stubDetail({ isOrphan: true }));
      expect(screen.getByText(/\(deleted\)/i)).toBeDefined();
    });

    it("does not render the deleted marker when the workflow still exists", () => {
      renderDetail(stubDetail({ isOrphan: false }));
      expect(screen.queryByText(/\(deleted\)/i)).toBeNull();
    });
  });

  describe("run-level failure", () => {
    it("renders the failure block above the steps section when the run errored", () => {
      renderDetail(
        stubDetail({
          status: "failed",
          error: { message: "step 'lint' exited 1" },
        }),
      );
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Run failed");
      expect(alert.textContent).toContain("step 'lint' exited 1");
    });

    it("hides the stack trace by default and reveals it on toggle", () => {
      renderDetail(
        stubDetail({
          status: "failed",
          error: { message: "boom", stack: "at frob() at line 42" },
        }),
      );
      expect(screen.queryByText(/frob\(\)/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /show stack/i }));
      expect(screen.getByText(/frob\(\) at line 42/)).toBeDefined();
    });

    it("does not render the failure block on a successful run", () => {
      renderDetail(stubDetail({ status: "ok", error: null }));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("cancel button", () => {
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("renders when the run is running and an onCancel handler is provided", () => {
      renderDetail(stubDetail({ status: "running", finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
      });
      expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
    });

    it("does not render when no onCancel handler is provided (presentational fallback)", () => {
      renderDetail(stubDetail({ status: "running", finishedAt: null }));
      expect(screen.queryByRole("button", { name: /cancel run/i })).toBeNull();
    });

    it.each(["ok", "failed", "cancelled"] as const)(
      "is hidden for terminal status: %s",
      (status) => {
        renderDetail(stubDetail({ status }), {
          onCancel: () => Promise.resolve({ runId: "run-1" }),
        });
        expect(screen.queryByRole("button", { name: /cancel run/i })).toBeNull();
      },
    );

    it("is hidden for orphaned runs (status renders as interrupted)", () => {
      renderDetail(stubDetail({ status: "running", isOrphan: true, finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
      });
      expect(screen.queryByRole("button", { name: /cancel run/i })).toBeNull();
    });

    it("invokes onCancel exactly once on click", async () => {
      let calls = 0;
      const onCancel = () => {
        calls++;
        return Promise.resolve({ runId: "run-1" });
      };
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
        await flushMicrotasks();
      });

      expect(calls).toBe(1);
    });

    it("shows a pending label and disables the button while the request is in flight", async () => {
      let resolve: (() => void) | undefined;
      const onCancel = () =>
        new Promise<{ runId: string }>((res) => {
          resolve = () => res({ runId: "run-1" });
        });
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      const button = screen.getByRole("button", { name: /cancel run/i });
      act(() => {
        fireEvent.click(button);
      });

      const pending = screen.getByRole("button", { name: /cancelling/i });
      expect(pending.hasAttribute("disabled")).toBe(true);

      await act(async () => {
        resolve?.();
        await flushMicrotasks();
      });

      // After the request resolves the button returns to its idle label.
      expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
    });

    it("surfaces the error message inline when onCancel rejects", async () => {
      const onCancel = () => Promise.reject(new Error('run "abc" is not in flight'));
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /cancel run/i }));
        await flushMicrotasks();
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain('run "abc" is not in flight');
      // Button is re-enabled and back to its idle label so the user can retry.
      const button = screen.getByRole("button", { name: /cancel run/i });
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("step list", () => {
    it("renders an empty-state sentence when there are no steps", () => {
      renderDetail(stubDetail({}, []));
      expect(screen.getByText(/no steps recorded/i)).toBeDefined();
    });

    it("renders the step count in the section header", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({ id: "s1", index: 0 }),
          stubStep({ id: "s2", index: 1 }),
          stubStep({ id: "s3", index: 2 }),
        ]),
      );
      expect(screen.getByText(/^3 steps$/)).toBeDefined();
    });

    it("renders the singular form when there is exactly one step", () => {
      renderDetail(stubDetail({}, [stubStep()]));
      expect(screen.getByText(/^1 step$/)).toBeDefined();
    });

    it("renders the step number padded to two digits", () => {
      renderDetail(stubDetail({}, [stubStep({ index: 0 })]));
      expect(screen.getByText("01")).toBeDefined();
    });

    it("renders the step duration in the row", () => {
      renderDetail(
        stubDetail({}, [stubStep({ traces: { stdout: "", stderr: "", durationMs: 1_400 } })]),
      );
      expect(screen.getByText("1.4s")).toBeDefined();
    });

    it("renders an em-dash for steps with no traces yet", () => {
      renderDetail(stubDetail({}, [stubStep({ status: "running", traces: null })]));
      expect(screen.getByText("—")).toBeDefined();
    });

    it("labels a use: step with the bundle name", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            materials: { kind: "use", bundle: "claude-code", files: { "run.sh": "#!/bin/sh" } },
          }),
        ]),
      );
      expect(screen.getByText("use: claude-code")).toBeDefined();
    });

    it("labels a sh: step with the first line of the inline source, truncated", () => {
      renderDetail(
        stubDetail({}, [stubStep({ materials: { kind: "sh", source: "echo hello\nexit 0" } })]),
      );
      expect(screen.getByText(/^sh: echo hello$/)).toBeDefined();
    });

    it("tags failed step rows with data-status='failed'", () => {
      const { container } = renderDetail(stubDetail({}, [stubStep({ status: "failed" })]));
      expect(container.querySelector("[data-status='failed']")).toBeDefined();
    });
  });

  describe("step disclosure", () => {
    it("collapses step rows by default", () => {
      renderDetail(
        stubDetail({}, [stubStep({ traces: { stdout: "hello", stderr: "", durationMs: 5 } })]),
      );
      expect(screen.queryByText("hello")).toBeNull();
      expect(screen.getByRole("button", { name: /sh:/i }).getAttribute("aria-expanded")).toBe(
        "false",
      );
    });

    it("expands a step on click and reveals stdout / stderr blocks", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            traces: { stdout: "ran ok", stderr: "warning: foo", durationMs: 5 },
          }),
        ]),
      );
      fireEvent.click(screen.getByRole("button", { name: /sh:/i }));
      expect(screen.getByText("ran ok")).toBeDefined();
      expect(screen.getByText("warning: foo")).toBeDefined();
    });

    it("renders an empty-state placeholder for empty stdout / stderr", () => {
      renderDetail(
        stubDetail({}, [stubStep({ traces: { stdout: "", stderr: "", durationMs: 5 } })]),
      );
      fireEvent.click(screen.getByRole("button", { name: /sh:/i }));
      const stdoutHeading = screen.getByText(/^stdout$/i);
      const stdoutPanel = stdoutHeading.parentElement;
      expect(stdoutPanel?.textContent).toContain("(empty)");
    });

    it("renders the step error envelope when the step failed", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            status: "failed",
            error: { message: "exit 1" },
            traces: { stdout: "", stderr: "", durationMs: 2 },
          }),
        ]),
      );
      fireEvent.click(screen.getByRole("button", { name: /sh:/i }));
      const errorHeading = screen.getByText(/^error$/i);
      const errorPanel = errorHeading.parentElement;
      expect(errorPanel?.textContent).toContain("exit 1");
    });
  });

  describe("step materials", () => {
    it("renders the inline source for sh: steps", () => {
      renderDetail(
        stubDetail({}, [stubStep({ materials: { kind: "sh", source: "echo materials body" } })]),
      );
      fireEvent.click(screen.getByRole("button", { name: /sh:/i }));
      expect(screen.getByText(/inline shell/i)).toBeDefined();
      expect(screen.getByText("echo materials body")).toBeDefined();
    });

    it("renders a file disclosure list for use: bundles", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            materials: {
              kind: "use",
              bundle: "claude-code",
              files: { "run.sh": "#!/bin/sh", "README.md": "# bundle" },
            },
          }),
        ]),
      );
      fireEvent.click(screen.getByRole("button", { name: /use: claude-code/i }));

      const materialsHeading = screen.getByText(/materials — bundle/i);
      const wrapper = materialsHeading.parentElement;
      expect(wrapper?.textContent).toContain("claude-code");

      expect(screen.getByRole("button", { name: /run\.sh/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /README\.md/i })).toBeDefined();
    });

    it("expands a bundle file on click to show its source", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            materials: {
              kind: "use",
              bundle: "claude-code",
              files: { "run.sh": "echo hi from bundle" },
            },
          }),
        ]),
      );
      fireEvent.click(screen.getByRole("button", { name: /use: claude-code/i }));

      expect(screen.queryByText("echo hi from bundle")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /run\.sh/i }));
      expect(screen.getByText("echo hi from bundle")).toBeDefined();
    });

    it("sorts bundle files alphabetically by path", () => {
      renderDetail(
        stubDetail({}, [
          stubStep({
            materials: {
              kind: "use",
              bundle: "b",
              files: { "z.sh": "z", "a.sh": "a", "m.sh": "m" },
            },
          }),
        ]),
      );
      fireEvent.click(screen.getByRole("button", { name: /use: b/i }));

      const list = screen.getByRole("button", { name: /a\.sh/i }).closest("ul");
      const paths = within(list as HTMLElement)
        .getAllByRole("button")
        .map((btn) => btn.querySelector("span:last-child")?.textContent);
      expect(paths).toEqual(["a.sh", "m.sh", "z.sh"]);
    });
  });
});
