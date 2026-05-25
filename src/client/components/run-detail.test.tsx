import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type {
  ArticleSummary,
  RunDetail,
  RunDetailRun,
  RunStepRow,
  WorkflowInputSummary,
} from "../api.ts";
import { RunDetailView } from "./run-detail.tsx";

afterEach(() => cleanup());

const NOW = new Date("2026-05-09T12:00:00.000Z");

const stubRun = (overrides: Partial<RunDetailRun> = {}): RunDetailRun => ({
  id: "run-1",
  workflowName: "kiri-self-review",
  status: "ok",
  trigger: "manual",
  startedAt: new Date(NOW.getTime() - 3 * 60 * 1000).toISOString(),
  finishedAt: new Date(NOW.getTime() - 3 * 60 * 1000 + 12_000).toISOString(),
  error: null,
  summary: null,
  definitionSnapshot: { name: "kiri-self-review", steps: [{ sh: "echo hello, world" }] },
  gitSha: null,
  gitDirty: null,
  inputs: null,
  isInterrupted: false,
  articles: [],
  recommendations: [],
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
  isSummary: false,
  isPublish: false,
  ...overrides,
});

const stubDetail = (
  run: Partial<RunDetailRun> = {},
  steps: RunStepRow[] = [],
  articles: ArticleSummary[] = [],
): RunDetail => ({
  run: stubRun({ ...run, articles }),
  steps,
});

const renderDetail = (
  detail: RunDetail,
  opts: {
    onCancel?: () => Promise<unknown>;
    onDelete?: () => Promise<unknown>;
    onRerun?: (inputs?: Record<string, string>) => Promise<unknown>;
    workflowInputs?: WorkflowInputSummary[];
  } = {},
) => {
  const { hook } = memoryLocation({ path: `/runs/${detail.run.id}` });
  return render(
    <Router hook={hook}>
      <RunDetailView
        detail={detail}
        now={NOW}
        onCancel={opts.onCancel}
        onDelete={opts.onDelete}
        onRerun={opts.onRerun}
        workflowInputs={opts.workflowInputs}
      />
    </Router>,
  );
};

describe("<RunDetailView>", () => {
  describe("header", () => {
    it("renders the workflow name as a level-2 heading", () => {
      renderDetail(stubDetail({ workflowName: "pr-review" }));
      expect(screen.getByRole("heading", { level: 2, name: /pr-review/i })).toBeDefined();
    });

    it("renders the run's status word in the header, keyed by data-status", () => {
      const { container } = renderDetail(stubDetail({ status: "failed" }));
      const status = container.querySelector('header [data-status="failed"]');
      expect(status?.textContent).toBe("failed");
    });

    it("renders cancelled runs with the cancelled status word in the header", () => {
      const { container } = renderDetail(stubDetail({ status: "cancelled" }));
      const status = container.querySelector('header [data-status="cancelled"]');
      expect(status?.textContent).toBe("cancelled");
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

    it("shows a short git sha in the metadata row with the full sha as a title", () => {
      const sha = "abc1234567890abcdef1234567890abcdef123456";
      renderDetail(stubDetail({ gitSha: sha, gitDirty: false }));
      const ref = screen.getByText("abc1234");
      expect(ref.getAttribute("title")).toBe(sha);
    });

    it("renders a (dirty) marker when the working tree had uncommitted changes", () => {
      renderDetail(
        stubDetail({ gitSha: "abc1234567890abcdef1234567890abcdef123456", gitDirty: true }),
      );
      expect(screen.getByText(/\(dirty\)/i)).toBeDefined();
    });

    it("omits the dirty marker on a clean git ref", () => {
      renderDetail(
        stubDetail({ gitSha: "abc1234567890abcdef1234567890abcdef123456", gitDirty: false }),
      );
      expect(screen.queryByText(/\(dirty\)/i)).toBeNull();
    });

    it("omits the git ref entirely when the data dir is not a git repo", () => {
      renderDetail(stubDetail({ gitSha: null, gitDirty: null }));
      expect(screen.queryByText(/\(dirty\)/i)).toBeNull();
      // The sr-only `git ref` label is only rendered alongside the sha;
      // its absence confirms the whole segment is gone.
      expect(screen.queryByText("git ref")).toBeNull();
    });
  });

  describe("deleted workflow", () => {
    it("preserves the underlying status when the workflow no longer exists", () => {
      const { container } = renderDetail(stubDetail({ status: "ok", isInterrupted: true }));
      const status = container.querySelector('header [data-status="ok"]');
      expect(status?.textContent).toBe("ok");
    });

    it("renders a deleted marker in the byline", () => {
      renderDetail(stubDetail({ isInterrupted: true }));
      expect(screen.getByText(/^deleted$/i)).toBeDefined();
    });

    it("does not render the deleted marker when the workflow still exists", () => {
      renderDetail(stubDetail({ isInterrupted: false }));
      expect(screen.queryByText(/^deleted$/i)).toBeNull();
    });
  });

  describe("run-level failure", () => {
    it("renders the failure block above the activity list when the run errored", () => {
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

    it("hides the stack trace by default and reveals it on toggle", async () => {
      const user = userEvent.setup();
      renderDetail(
        stubDetail({
          status: "failed",
          error: { message: "boom", stack: "at frob() at line 42" },
        }),
      );
      expect(screen.queryByText(/frob\(\)/)).toBeNull();
      await user.click(screen.getByRole("button", { name: /show stack/i }));
      expect(screen.getByText(/frob\(\) at line 42/)).toBeDefined();
    });

    it("does not render the failure block on a successful run", () => {
      renderDetail(stubDetail({ status: "ok", error: null }));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("cancel button", () => {
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

    it("stays visible for running runs whose workflow has been deleted", () => {
      renderDetail(stubDetail({ status: "running", isInterrupted: true, finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
      });
      expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
    });

    it("invokes onCancel exactly once on click", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const onCancel = () => {
        calls++;
        return Promise.resolve({ runId: "run-1" });
      };
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      await user.click(screen.getByRole("button", { name: /cancel run/i }));

      expect(calls).toBe(1);
    });

    it("shows a pending label and disables the button while the request is in flight", async () => {
      const user = userEvent.setup();
      let resolve: (() => void) | undefined;
      const onCancel = () =>
        new Promise<{ runId: string }>((res) => {
          resolve = () => res({ runId: "run-1" });
        });
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      await user.click(screen.getByRole("button", { name: /cancel run/i }));

      const pending = screen.getByRole("button", { name: /cancelling/i });
      expect(pending.hasAttribute("disabled")).toBe(true);

      resolve?.();
      // After the request resolves the button returns to its idle label.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
      });
    });

    it("surfaces the error message inline when onCancel rejects", async () => {
      const user = userEvent.setup();
      const onCancel = () => Promise.reject(new Error('run "abc" is not in flight'));
      renderDetail(stubDetail({ status: "running", finishedAt: null }), { onCancel });

      await user.click(screen.getByRole("button", { name: /cancel run/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain('run "abc" is not in flight');
      // Button is re-enabled and back to its idle label so the user can retry.
      const button = screen.getByRole("button", { name: /cancel run/i });
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("delete button", () => {
    it.each(["ok", "failed", "cancelled"] as const)(
      "renders for the terminal status %s when onDelete is provided",
      (status) => {
        renderDetail(stubDetail({ status }), {
          onDelete: () => Promise.resolve(),
        });
        expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
      },
    );

    it("does not render while the run is still running (cancel takes the slot)", () => {
      renderDetail(stubDetail({ status: "running", finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
        onDelete: () => Promise.resolve(),
      });
      expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
      expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
    });

    it("does not render when no onDelete handler is provided (presentational fallback)", () => {
      renderDetail(stubDetail({ status: "ok" }));
      expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
    });

    it("invokes onDelete exactly once on click", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const onDelete = () => {
        calls++;
        return Promise.resolve();
      };
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      expect(calls).toBe(1);
    });

    it("shows a pending label and disables the button while the request is in flight", async () => {
      const user = userEvent.setup();
      let resolve: (() => void) | undefined;
      const onDelete = () =>
        new Promise<void>((res) => {
          resolve = () => res();
        });
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      const pending = screen.getByRole("button", { name: /deleting/i });
      expect(pending.hasAttribute("disabled")).toBe(true);

      resolve?.();
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
      });
    });

    it("surfaces the error message inline when onDelete rejects", async () => {
      const user = userEvent.setup();
      const onDelete = () => Promise.reject(new Error('run "abc" is in flight; cancel it first'));
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      await user.click(screen.getByRole("button", { name: /^delete$/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain('run "abc" is in flight; cancel it first');
      const button = screen.getByRole("button", { name: /^delete$/i });
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("rerun button", () => {
    it.each(["ok", "failed", "cancelled"] as const)(
      "renders for the terminal status %s when onRerun is provided",
      (status) => {
        renderDetail(stubDetail({ status }), {
          onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
        });
        expect(screen.getByRole("button", { name: /run again/i })).toBeDefined();
      },
    );

    it("does not render while the run is still running (cancel takes the slot)", () => {
      renderDetail(stubDetail({ status: "running", finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
        onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
      });
      expect(screen.queryByRole("button", { name: /run again/i })).toBeNull();
    });

    it("does not render when no onRerun handler is provided (presentational fallback)", () => {
      renderDetail(stubDetail({ status: "ok" }));
      expect(screen.queryByRole("button", { name: /run again/i })).toBeNull();
    });

    it("renders alongside delete on terminal runs", () => {
      renderDetail(stubDetail({ status: "ok" }), {
        onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
        onDelete: () => Promise.resolve(),
      });
      expect(screen.getByRole("button", { name: /run again/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
    });

    it("disables the button with an explanatory tooltip when the workflow is interrupted", () => {
      renderDetail(stubDetail({ status: "failed", isInterrupted: true }), {
        onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
      });
      const button = screen.getByRole("button", { name: /run again/i });
      expect(button.hasAttribute("disabled")).toBe(true);
      expect(button.getAttribute("title")).toContain("no longer exists");
    });

    it("does not invoke onRerun when the button is disabled (interrupted)", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const onRerun = () => {
        calls++;
        return Promise.resolve({ runId: "run-1", status: "running" as const });
      };
      renderDetail(stubDetail({ status: "failed", isInterrupted: true }), { onRerun });

      await user.click(screen.getByRole("button", { name: /run again/i }));

      expect(calls).toBe(0);
    });

    it("invokes onRerun exactly once on click", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const onRerun = () => {
        calls++;
        return Promise.resolve({ runId: "run-1", status: "running" as const });
      };
      renderDetail(stubDetail({ status: "ok" }), { onRerun });

      await user.click(screen.getByRole("button", { name: /run again/i }));

      expect(calls).toBe(1);
    });

    it("shows a pending label and disables the button while the request is in flight", async () => {
      const user = userEvent.setup();
      let resolve: ((value: { runId: string; status: "running" }) => void) | undefined;
      const onRerun = () =>
        new Promise<{ runId: string; status: "running" }>((res) => {
          resolve = res;
        });
      renderDetail(stubDetail({ status: "ok" }), { onRerun });

      await user.click(screen.getByRole("button", { name: /run again/i }));

      const pending = screen.getByRole("button", { name: /starting/i });
      expect(pending.hasAttribute("disabled")).toBe(true);

      resolve?.({ runId: "run-1", status: "running" });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /run again/i })).toBeDefined();
      });
    });

    it("surfaces the error message inline when onRerun rejects", async () => {
      const user = userEvent.setup();
      const onRerun = () => Promise.reject(new Error('run "abc" is in flight; cancel it first'));
      renderDetail(stubDetail({ status: "ok" }), { onRerun });

      await user.click(screen.getByRole("button", { name: /run again/i }));

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain('run "abc" is in flight; cancel it first');
      const button = screen.getByRole("button", { name: /run again/i });
      expect(button.hasAttribute("disabled")).toBe(false);
    });

    describe("with workflow inputs", () => {
      const inputs: WorkflowInputSummary[] = [
        { name: "pr_number", required: true },
        { name: "branch", default: "main" },
      ];

      it("renders a warning in the modal that the prior attempt will be cleared", async () => {
        const user = userEvent.setup();
        renderDetail(
          stubDetail({
            status: "ok",
            inputs: { pr_number: "42", branch: "release" },
          }),
          {
            onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
            workflowInputs: inputs,
          },
        );

        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        // Same wording as the no-inputs path's window.confirm so users see
        // the same caveat regardless of which re-run path the workflow uses.
        const note = within(dialog).getByRole("note");
        expect(note.textContent).toContain(
          "The previous attempt's steps and traces will be cleared.",
        );
      });

      it("opens the invoke modal pre-filled from prior run.inputs when the workflow has inputs", async () => {
        const user = userEvent.setup();
        renderDetail(
          stubDetail({
            status: "ok",
            inputs: { pr_number: "42", branch: "release" },
          }),
          {
            onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
            workflowInputs: inputs,
          },
        );

        // Clicking "run again" opens the modal instead of firing immediately.
        await user.click(screen.getByRole("button", { name: /run again/i }));

        const dialog = screen.getByRole("dialog");
        expect(dialog).toBeDefined();
        expect(
          within(dialog).getByRole("heading", { level: 2, name: /run kiri-self-review/i }),
        ).toBeDefined();
        expect((within(dialog).getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
        expect((within(dialog).getByLabelText(/branch/i) as HTMLInputElement).value).toBe(
          "release",
        );
      });

      it("falls back to declared defaults for inputs added since the original run", async () => {
        const user = userEvent.setup();
        renderDetail(
          stubDetail({
            status: "ok",
            // Prior run only knew about pr_number; branch is new on the workflow.
            inputs: { pr_number: "42" },
          }),
          {
            onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
            workflowInputs: inputs,
          },
        );

        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        expect((within(dialog).getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
        // `branch` falls through to the workflow's declared default.
        expect((within(dialog).getByLabelText(/branch/i) as HTMLInputElement).value).toBe("main");
      });

      it("silently drops prior values for inputs no longer declared on the workflow", async () => {
        const user = userEvent.setup();
        renderDetail(
          stubDetail({
            status: "ok",
            // Prior run had a `legacy` input that the workflow no longer declares.
            inputs: { pr_number: "42", legacy: "obsolete" },
          }),
          {
            onRerun: () => Promise.resolve({ runId: "run-1", status: "running" as const }),
            workflowInputs: inputs,
          },
        );

        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        // Only the currently-declared fields are rendered; `legacy` doesn't appear.
        expect(within(dialog).queryByLabelText(/legacy/i)).toBeNull();
        expect((within(dialog).getByLabelText(/pr_number/i) as HTMLInputElement).value).toBe("42");
      });

      it("forwards the (possibly tweaked) values to onRerun on submit", async () => {
        const seen: Array<Record<string, string> | undefined> = [];
        const onRerun = (values?: Record<string, string>) => {
          seen.push(values);
          return Promise.resolve({ runId: "run-1", status: "running" as const });
        };
        renderDetail(
          stubDetail({
            status: "ok",
            inputs: { pr_number: "42", branch: "release" },
          }),
          { onRerun, workflowInputs: inputs },
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        // Tweak just the required field; branch stays on the prior snapshot.
        const pr = within(dialog).getByLabelText(/pr_number/i);
        await user.clear(pr);
        await user.type(pr, "99");
        await user.click(within(dialog).getByRole("button", { name: /^run/i }));

        expect(seen).toEqual([{ pr_number: "99", branch: "release" }]);
      });

      it("closes the modal when the user cancels without firing onRerun", async () => {
        let calls = 0;
        const onRerun = () => {
          calls++;
          return Promise.resolve({ runId: "run-1", status: "running" as const });
        };
        renderDetail(stubDetail({ status: "ok", inputs: { pr_number: "42", branch: "release" } }), {
          onRerun,
          workflowInputs: inputs,
        });

        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: /^cancel$/i }));

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(calls).toBe(0);
      });

      it("closes the modal after a successful submit", async () => {
        const onRerun = () => Promise.resolve({ runId: "run-1", status: "running" as const });
        renderDetail(
          stubDetail({
            status: "ok",
            inputs: { pr_number: "42", branch: "release" },
          }),
          { onRerun, workflowInputs: inputs },
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: /^run/i }));

        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("surfaces the API error inside the modal so the user can retry without losing values", async () => {
        const onRerun = () => Promise.reject(new Error("workflow no longer exists"));
        renderDetail(
          stubDetail({
            status: "ok",
            inputs: { pr_number: "42", branch: "release" },
          }),
          { onRerun, workflowInputs: inputs },
        );

        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /run again/i }));
        const dialog = screen.getByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: /^run/i }));

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("workflow no longer exists");
        // Dialog stays open with the user's tweaks intact.
        expect(screen.getByRole("dialog")).toBeDefined();
        expect(
          (within(screen.getByRole("dialog")).getByLabelText(/branch/i) as HTMLInputElement).value,
        ).toBe("release");
      });

      it("keeps the bare confirm-then-fire path when workflowInputs is empty", async () => {
        const user = userEvent.setup();
        let calls = 0;
        const onRerun = (values?: Record<string, string>) => {
          calls++;
          // No-inputs path: caller invokes without an args object.
          expect(values).toBeUndefined();
          return Promise.resolve({ runId: "run-1", status: "running" as const });
        };
        renderDetail(stubDetail({ status: "ok" }), {
          onRerun,
          workflowInputs: [],
        });

        await user.click(screen.getByRole("button", { name: /run again/i }));

        // Modal is *not* opened on the no-inputs path.
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(calls).toBe(1);
      });
    });
  });

  describe("activity list", () => {
    // A representative run definition: two pipeline steps, two publishes,
    // and a summariser. Tests below populate per-row state to exercise
    // pending / running / terminal transitions across kinds.
    const definitionWithEverything: RunDetailRun["definitionSnapshot"] = {
      name: "everything",
      steps: [{ sh: "echo one" }, { use: "linter" }],
      publish: [
        { name: "digest", title: "Daily Digest", use: "digest-bundle" },
        { name: "release-notes", use: "notes-bundle" },
      ],
      summarize: { use: "claude-code-summarizer" },
    };

    it("renders every declared activity as a pending row before any step has run", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      const list = screen.getByRole("list", { name: /^activity$/i });
      const rows = within(list).queryAllByRole("listitem");
      // Two pipeline steps + two publishes + one summariser = 5 expected rows.
      expect(rows).toHaveLength(5);
      // All five are pending — there's no step row yet for any of them.
      for (const row of rows) {
        expect(row.querySelector('[data-status="pending"]')).not.toBeNull();
      }
    });

    it("numbers every row in declared order, padded to two digits", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      const list = screen.getByRole("list", { name: /^activity$/i });
      const rows = within(list).queryAllByRole("listitem");
      const ordinals = rows.map((r) => within(r).getByText(/^\d{2}$/).textContent);
      expect(ordinals).toEqual(["01", "02", "03", "04", "05"]);
    });

    it("tags each row with its activity kind", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      const list = screen.getByRole("list", { name: /^activity$/i });
      const rows = within(list).queryAllByRole("listitem");
      const kinds = rows.map((r) => r.querySelector("[data-kind]")?.getAttribute("data-kind"));
      expect(kinds).toEqual(["step", "step", "publishing", "publishing", "summarising"]);
    });

    it("renders the activity item count in the section header", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      expect(screen.getByText(/^5 items$/)).toBeDefined();
    });

    it("uses the singular form when there is exactly one activity item", () => {
      renderDetail(
        stubDetail({ definitionSnapshot: { name: "tiny", steps: [{ sh: "echo hi" }] } }, []),
      );
      expect(screen.getByText(/^1 item$/)).toBeDefined();
    });

    it("flips a pending row to running when its row materialises with running status", () => {
      renderDetail(
        stubDetail({ definitionSnapshot: definitionWithEverything }, [
          stubStep({ id: "s0", index: 0, status: "ok" }),
          stubStep({
            id: "s1",
            index: 1,
            status: "running",
            traces: null,
            kind: "use",
          }),
        ]),
      );
      const list = screen.getByRole("list", { name: /^activity$/i });
      const rows = within(list).queryAllByRole("listitem");
      // Row 0 = ok, row 1 = running, rows 2..4 still pending.
      expect(rows[0].querySelector('[data-status="ok"]')).not.toBeNull();
      expect(rows[1].querySelector('[data-status="running"]')).not.toBeNull();
      for (let i = 2; i < 5; i++) {
        expect(rows[i].querySelector('[data-status="pending"]')).not.toBeNull();
      }
    });

    it("renders a consistent running indicator (pulse + 'running') across kinds", () => {
      renderDetail(
        stubDetail({ definitionSnapshot: definitionWithEverything }, [
          stubStep({ id: "s0", index: 0, status: "ok" }),
          stubStep({ id: "s1", index: 1, status: "ok" }),
          stubStep({
            id: "p0",
            index: 2,
            status: "running",
            traces: null,
            kind: "use",
            isPublish: true,
          }),
          stubStep({
            id: "p1",
            index: 3,
            status: "ok",
            isPublish: true,
          }),
          stubStep({
            id: "sum",
            index: 4,
            status: "running",
            traces: null,
            kind: "use",
            isSummary: true,
          }),
        ]),
      );
      // Every running row renders "running" in a status-running coloured span;
      // none of the rows render a kind-specific running word like "publishing
      // …" or "Summarising…" — those were the inconsistencies we collapsed.
      const runningWords = screen.getAllByText(/^running$/);
      expect(runningWords).toHaveLength(2);
      expect(screen.queryByText(/Summarising/)).toBeNull();
    });

    it("uses the declared publish title (not the bundle) on publishing rows", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      // Pending publishing rows: titles come from the snapshot's name/title
      // resolved via the shared `resolvePublishTitle`.
      expect(screen.getByText("Daily Digest")).toBeDefined();
      // The second publish has no explicit title — titlecase from the name.
      expect(screen.getByText("Release Notes")).toBeDefined();
    });

    it("labels step rows with the declared step identifier", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      expect(screen.getByText(/^sh: echo one$/)).toBeDefined();
      expect(screen.getByText(/^use: linter$/)).toBeDefined();
    });

    it("labels the summariser row with its declared identifier", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      expect(screen.getByText(/^use: claude-code-summarizer$/)).toBeDefined();
    });

    it("renders the row duration when traces are populated, em-dash otherwise", () => {
      renderDetail(
        stubDetail({ definitionSnapshot: definitionWithEverything }, [
          stubStep({
            id: "s0",
            index: 0,
            status: "ok",
            traces: { stdout: "", stderr: "", durationMs: 2_500 },
          }),
        ]),
      );
      // Row 0 has traces → 2.5s. The remaining four are pending → em-dash.
      expect(screen.getByText("2.5s")).toBeDefined();
      expect(screen.getAllByText("—")).toHaveLength(4);
    });

    it("renders pending rows as non-interactive (no expand button)", () => {
      renderDetail(stubDetail({ definitionSnapshot: definitionWithEverything }, []));
      // No row in the list has an expand button while pending.
      const list = screen.getByRole("list", { name: /^activity$/i });
      expect(within(list).queryAllByRole("button")).toHaveLength(0);
    });

    it("expands a row's disclosure to reveal stdout / stderr once a row has run", async () => {
      const user = userEvent.setup();
      renderDetail(
        stubDetail(
          {
            definitionSnapshot: {
              name: "one-step",
              steps: [{ sh: "echo hi" }],
            },
          },
          [
            stubStep({
              id: "only",
              index: 0,
              status: "ok",
              traces: { stdout: "ran ok", stderr: "warning: foo", durationMs: 5 },
            }),
          ],
        ),
      );
      // Disclosure closed by default; nothing in the trace bodies is rendered.
      expect(screen.queryByText("ran ok")).toBeNull();
      await user.click(screen.getByRole("button", { name: /sh: echo hi/i }));
      expect(screen.getByText("ran ok")).toBeDefined();
      expect(screen.getByText("warning: foo")).toBeDefined();
    });

    it("renders the step's error envelope inside the disclosure when the row failed", async () => {
      const user = userEvent.setup();
      renderDetail(
        stubDetail(
          {
            status: "failed",
            error: { message: "step 'lint' exited 1" },
            definitionSnapshot: { name: "one-step", steps: [{ sh: "false" }] },
          },
          [
            stubStep({
              id: "only",
              index: 0,
              status: "failed",
              error: { message: "exit 1" },
              traces: { stdout: "", stderr: "", durationMs: 2 },
            }),
          ],
        ),
      );
      await user.click(screen.getByRole("button", { name: /sh: false/i }));
      const errorHeading = screen.getByText(/^error$/i);
      const errorPanel = errorHeading.parentElement;
      expect(errorPanel?.textContent).toContain("exit 1");
    });

    it("renders an empty-state placeholder for empty stdout / stderr in the disclosure", async () => {
      const user = userEvent.setup();
      renderDetail(
        stubDetail({ definitionSnapshot: { name: "one-step", steps: [{ sh: "noop" }] } }, [
          stubStep({
            id: "only",
            index: 0,
            status: "ok",
            traces: { stdout: "", stderr: "", durationMs: 5 },
          }),
        ]),
      );
      await user.click(screen.getByRole("button", { name: /sh: noop/i }));
      const stdoutHeading = screen.getByText(/^stdout$/i);
      expect(stdoutHeading.parentElement?.textContent).toContain("(empty)");
    });

    it("tags failed rows with data-status='failed'", () => {
      const { container } = renderDetail(
        stubDetail({ definitionSnapshot: { name: "one-step", steps: [{ sh: "false" }] } }, [
          stubStep({ id: "only", index: 0, status: "failed" }),
        ]),
      );
      expect(container.querySelector('[data-status="failed"][data-kind="step"]')).not.toBeNull();
    });

    it("hides the summariser row when no summariser is declared", () => {
      renderDetail(
        stubDetail(
          {
            definitionSnapshot: {
              name: "no-summary",
              steps: [{ sh: "echo hi" }],
            },
          },
          [],
        ),
      );
      const list = screen.getByRole("list", { name: /^activity$/i });
      expect(within(list).queryAllByRole("listitem")).toHaveLength(1);
      expect(within(list).queryAllByText(/summarising/i)).toHaveLength(0);
    });

    it("omits publishing rows when the workflow has no publish entries", () => {
      renderDetail(
        stubDetail(
          {
            definitionSnapshot: {
              name: "no-publish",
              steps: [{ sh: "echo hi" }],
              summarize: { use: "claude-code-summarizer" },
            },
          },
          [],
        ),
      );
      const list = screen.getByRole("list", { name: /^activity$/i });
      expect(within(list).queryAllByText(/publishing/i)).toHaveLength(0);
      // step + summariser, no publishing rows.
      expect(within(list).queryAllByRole("listitem")).toHaveLength(2);
    });
  });

  describe("inputs section", () => {
    it("renders a name/value row per input with the section heading and count", () => {
      renderDetail(
        stubDetail({
          inputs: { pr_number: "42", owner: "kiri", branch: "main" },
        }),
      );
      const heading = screen.getByRole("heading", { level: 3, name: /^inputs$/i });
      expect(heading).toBeDefined();
      expect(screen.getByText(/^3 inputs$/)).toBeDefined();

      const section = heading.closest("section");
      expect(section).not.toBeNull();
      const labels = within(section as HTMLElement)
        .getAllByRole("term")
        .map((el) => el.textContent);
      const values = within(section as HTMLElement)
        .getAllByRole("definition")
        .map((el) => el.textContent);
      expect(labels).toEqual(["pr_number", "owner", "branch"]);
      expect(values).toEqual(["42", "kiri", "main"]);
    });

    it("uses the singular form for a single input", () => {
      renderDetail(stubDetail({ inputs: { pr_number: "42" } }));
      expect(screen.getByText(/^1 input$/)).toBeDefined();
    });

    it("renders values as plain text — HTML-like content is not interpreted", () => {
      renderDetail(stubDetail({ inputs: { note: "<script>alert(1)</script>" } }));
      const section = screen.getByRole("heading", { name: /^inputs$/i }).closest("section");
      const value = within(section as HTMLElement).getByRole("definition");
      expect(value.textContent).toBe("<script>alert(1)</script>");
      // Defence-in-depth: nothing inside the value should have become a real
      // element. React already escapes text children, but assert explicitly.
      expect(value.querySelector("script")).toBeNull();
    });

    it("does not render the section when run.inputs is null", () => {
      renderDetail(stubDetail({ inputs: null }));
      expect(screen.queryByRole("heading", { name: /^inputs$/i })).toBeNull();
    });

    it("does not render the section when run.inputs is an empty object", () => {
      renderDetail(stubDetail({ inputs: {} }));
      expect(screen.queryByRole("heading", { name: /^inputs$/i })).toBeNull();
    });
  });

  describe("summary", () => {
    it("renders the summary section above the activity list when run.summary is set", () => {
      renderDetail(stubDetail({ summary: "Reviewed PR #42 and flagged a regression in auth.ts." }));
      const heading = screen.getByText(/^summary$/i);
      expect(heading).toBeDefined();
      const body = screen.getByText(/regression in auth\.ts/);
      expect(body).toBeDefined();
    });

    it("does not render the summary section when run.summary is null", () => {
      renderDetail(stubDetail({ summary: null }));
      expect(screen.queryByText(/^summary$/i)).toBeNull();
    });

    it("renders a list-shaped summary as a bullet list, not as one prose run", () => {
      const summary = [
        "- **#42** payments: refund flow tweaks",
        "- **#43** auth: rotate session secret",
      ].join("\n");
      renderDetail(stubDetail({ summary }));
      // Scope to the Summary section so the Activity <ol> below doesn't bleed
      // into the listitem query.
      const summarySection = screen.getByText(/^summary$/i).closest("section");
      const bullets = Array.from(summarySection?.querySelectorAll("li") ?? []).map(
        (li) => li.textContent ?? "",
      );
      expect(bullets).toEqual([
        "#42 payments: refund flow tweaks",
        "#43 auth: rotate session secret",
      ]);
    });
  });

  describe("published section", () => {
    const stubArticle = (overrides: Partial<ArticleSummary> = {}): ArticleSummary => ({
      name: "digest",
      title: "PR Review Digest",
      createdAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      ...overrides,
    });

    it("does not render the section when there are no articles", () => {
      renderDetail(stubDetail({}, [], []));
      expect(screen.queryByRole("heading", { name: /^published$/i })).toBeNull();
    });

    it("renders the section heading and a row per article when present", () => {
      renderDetail(
        stubDetail({}, [], [stubArticle({ name: "digest", title: "PR Review Digest" })]),
      );
      expect(screen.getByRole("heading", { level: 3, name: /^published$/i })).toBeDefined();
      expect(screen.getByText("PR Review Digest")).toBeDefined();
    });

    it("renders the article count in the section header", () => {
      renderDetail(
        stubDetail(
          {},
          [],
          [
            stubArticle({ name: "digest", title: "Digest" }),
            stubArticle({ name: "notes", title: "Notes" }),
          ],
        ),
      );
      expect(screen.getByText(/^2 articles$/)).toBeDefined();
    });

    it("uses the singular form for a single article", () => {
      renderDetail(stubDetail({}, [], [stubArticle()]));
      expect(screen.getByText(/^1 article$/)).toBeDefined();
    });

    it("links each article to /runs/:id/published/:name", () => {
      renderDetail(
        stubDetail(
          { id: "run-1" },
          [],
          [
            stubArticle({ name: "digest", title: "Digest" }),
            stubArticle({ name: "release-notes", title: "Release Notes" }),
          ],
        ),
      );
      const digestLink = screen.getByRole("link", { name: /digest/i });
      expect(digestLink.getAttribute("href")).toBe("/runs/run-1/published/digest");
      const notesLink = screen.getByRole("link", { name: /release notes/i });
      expect(notesLink.getAttribute("href")).toBe("/runs/run-1/published/release-notes");
    });

    it("renders the created-at as a relative timestamp with absolute hover title", () => {
      const createdAt = new Date(NOW.getTime() - 45 * 1000).toISOString();
      renderDetail(stubDetail({}, [], [stubArticle({ createdAt })]));
      const time = screen.getByText(/45 seconds ago/i);
      expect(time.getAttribute("title")).toBe(createdAt);
    });
  });
});
