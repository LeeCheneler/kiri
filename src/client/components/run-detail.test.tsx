import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { RunArtefactSummary, RunDetail, RunListEntry, RunStepRow } from "../api.ts";
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
  summary: null,
  definitionSnapshot: { name: "kiri-self-review", steps: [{ sh: "echo hello, world" }] },
  gitSha: null,
  gitDirty: null,
  isInterrupted: false,
  artefacts: [],
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
  run: Partial<RunListEntry> = {},
  steps: RunStepRow[] = [],
  artefacts: RunArtefactSummary[] = [],
): RunDetail => ({
  run: stubRun({ ...run, artefacts }),
  steps,
});

const renderDetail = (
  detail: RunDetail,
  opts: { onCancel?: () => Promise<unknown>; onDelete?: () => Promise<unknown> } = {},
) => {
  const { hook } = memoryLocation({ path: `/runs/${detail.run.id}` });
  return render(
    <Router hook={hook}>
      <RunDetailView detail={detail} now={NOW} onCancel={opts.onCancel} onDelete={opts.onDelete} />
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
      const status = container.querySelector('header [data-status="failed"]');
      expect(status?.textContent).toBe("failed");
      expect(status?.className).toContain("text-status-failed");
    });

    it("renders cancelled runs with the cancelled status colour", () => {
      const { container } = renderDetail(stubDetail({ status: "cancelled" }));
      const status = container.querySelector('header [data-status="cancelled"]');
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
      expect(status?.className).toContain("text-status-ok");
    });

    it("appends a (deleted) marker after the workflow name", () => {
      renderDetail(stubDetail({ isInterrupted: true }));
      expect(screen.getByText(/\(deleted\)/i)).toBeDefined();
    });

    it("does not render the deleted marker when the workflow still exists", () => {
      renderDetail(stubDetail({ isInterrupted: false }));
      expect(screen.queryByText(/\(deleted\)/i)).toBeNull();
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

    it("stays visible for running runs whose workflow has been deleted", () => {
      renderDetail(stubDetail({ status: "running", isInterrupted: true, finishedAt: null }), {
        onCancel: () => Promise.resolve({ runId: "run-1" }),
      });
      expect(screen.getByRole("button", { name: /cancel run/i })).toBeDefined();
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

  describe("delete button", () => {
    const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

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
      let calls = 0;
      const onDelete = () => {
        calls++;
        return Promise.resolve();
      };
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
        await flushMicrotasks();
      });

      expect(calls).toBe(1);
    });

    it("shows a pending label and disables the button while the request is in flight", async () => {
      let resolve: (() => void) | undefined;
      const onDelete = () =>
        new Promise<void>((res) => {
          resolve = () => res();
        });
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      const button = screen.getByRole("button", { name: /^delete$/i });
      act(() => {
        fireEvent.click(button);
      });

      const pending = screen.getByRole("button", { name: /deleting/i });
      expect(pending.hasAttribute("disabled")).toBe(true);

      await act(async () => {
        resolve?.();
        await flushMicrotasks();
      });

      expect(screen.getByRole("button", { name: /^delete$/i })).toBeDefined();
    });

    it("surfaces the error message inline when onDelete rejects", async () => {
      const onDelete = () => Promise.reject(new Error('run "abc" is in flight; cancel it first'));
      renderDetail(stubDetail({ status: "ok" }), { onDelete });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
        await flushMicrotasks();
      });

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain('run "abc" is in flight; cancel it first');
      const button = screen.getByRole("button", { name: /^delete$/i });
      expect(button.hasAttribute("disabled")).toBe(false);
    });
  });

  describe("activity list", () => {
    // A representative run definition: two pipeline steps, two publishes,
    // and a summariser. Tests below populate per-row state to exercise
    // pending / running / terminal transitions across kinds.
    const definitionWithEverything: RunListEntry["definitionSnapshot"] = {
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

    it("expands a row's disclosure to reveal stdout / stderr once a row has run", () => {
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
      fireEvent.click(screen.getByRole("button", { name: /sh: echo hi/i }));
      expect(screen.getByText("ran ok")).toBeDefined();
      expect(screen.getByText("warning: foo")).toBeDefined();
    });

    it("renders the step's error envelope inside the disclosure when the row failed", () => {
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
      fireEvent.click(screen.getByRole("button", { name: /sh: false/i }));
      const errorHeading = screen.getByText(/^error$/i);
      const errorPanel = errorHeading.parentElement;
      expect(errorPanel?.textContent).toContain("exit 1");
    });

    it("renders an empty-state placeholder for empty stdout / stderr in the disclosure", () => {
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
      fireEvent.click(screen.getByRole("button", { name: /sh: noop/i }));
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
    const stubArtefact = (overrides: Partial<RunArtefactSummary> = {}): RunArtefactSummary => ({
      name: "digest",
      title: "PR Review Digest",
      createdAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      ...overrides,
    });

    it("does not render the section when there are no artefacts", () => {
      renderDetail(stubDetail({}, [], []));
      expect(screen.queryByRole("heading", { name: /^published$/i })).toBeNull();
    });

    it("renders the section heading and a row per artefact when present", () => {
      renderDetail(
        stubDetail({}, [], [stubArtefact({ name: "digest", title: "PR Review Digest" })]),
      );
      expect(screen.getByRole("heading", { level: 3, name: /^published$/i })).toBeDefined();
      expect(screen.getByText("PR Review Digest")).toBeDefined();
    });

    it("renders the artefact count in the section header", () => {
      renderDetail(
        stubDetail(
          {},
          [],
          [
            stubArtefact({ name: "digest", title: "Digest" }),
            stubArtefact({ name: "notes", title: "Notes" }),
          ],
        ),
      );
      expect(screen.getByText(/^2 artefacts$/)).toBeDefined();
    });

    it("uses the singular form for a single artefact", () => {
      renderDetail(stubDetail({}, [], [stubArtefact()]));
      expect(screen.getByText(/^1 artefact$/)).toBeDefined();
    });

    it("links each artefact to /runs/:id/published/:name", () => {
      renderDetail(
        stubDetail(
          { id: "run-1" },
          [],
          [
            stubArtefact({ name: "digest", title: "Digest" }),
            stubArtefact({ name: "release-notes", title: "Release Notes" }),
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
      renderDetail(stubDetail({}, [], [stubArtefact({ createdAt })]));
      const time = screen.getByText(/45 seconds ago/i);
      expect(time.getAttribute("title")).toBe(createdAt);
    });

    it("renders above the activity list so the long-form output is reached first", () => {
      renderDetail(
        stubDetail({}, [stubStep()], [stubArtefact({ name: "digest", title: "Digest" })]),
      );
      const published = screen.getByRole("heading", { name: /^published$/i });
      const activity = screen.getByRole("heading", { name: /^activity$/i });
      expect(published.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it("renders directly under the summary when both surfaces are visible", () => {
      renderDetail(
        stubDetail(
          { summary: "Top-line summary." },
          [],
          [stubArtefact({ name: "digest", title: "Digest" })],
        ),
      );
      const summary = screen.getByText(/^summary$/i);
      const published = screen.getByRole("heading", { name: /^published$/i });
      // summary → published (no intervening section between them on this run).
      expect(summary.compareDocumentPosition(published) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it("renders above the run failure block when a failure is present", () => {
      renderDetail(
        stubDetail(
          { status: "failed", error: { message: "boom" } },
          [],
          [stubArtefact({ name: "digest", title: "Digest" })],
        ),
      );
      const published = screen.getByRole("heading", { name: /^published$/i });
      const failure = screen.getByText(/^run failed$/i);
      expect(published.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });
});
