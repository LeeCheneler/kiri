import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { WorkflowPage } from "./workflow-page.tsx";

afterEach(() => cleanup());

const renderWorkflow = (name: string, initialPath = `/workflows/${name}`) => {
  const memory = memoryLocation({ path: initialPath, record: true });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={memory.hook}>
      <LiveEventsProvider factory={factory}>
        <WorkflowPage params={{ name }} />
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, history: memory.history, sources };
};

describe("<WorkflowPage>", () => {
  it("shows a loading message while the registry is being fetched", async () => {
    renderWorkflow("kiri-self-review");
    expect(screen.getByText(/loading workflow/i)).toBeDefined();
    await flushAsync();
  });

  it("delegates to the detail view when the workflow is in the registry", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          { name: "kiri-self-review", steps: [{ sh: "echo ok" }] },
          { name: "other", steps: [] },
        ]),
      ),
    );

    renderWorkflow("kiri-self-review");

    expect(
      await screen.findByRole("heading", { level: 2, name: /kiri-self-review/i }),
    ).toBeDefined();
    expect(screen.getByRole("tab", { name: "Recent runs" })).toBeDefined();
  });

  it("renders the workflow's recent runs as feed rows in the default tab", async () => {
    const seenWorkflow: (string | null)[] = [];
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          { name: "dev-patch", inputs: [{ name: "repo", required: true }], steps: [{ use: "x" }] },
        ]),
      ),
      http.get("*/api/runs", ({ request }) => {
        seenWorkflow.push(new URL(request.url).searchParams.get("workflow"));
        return HttpResponse.json({
          runs: [
            {
              id: "r1",
              workflowName: "dev-patch",
              status: "ok",
              startedAt: "2026-05-09T12:00:00.000Z",
              finishedAt: "2026-05-09T12:00:01.000Z",
              error: null,
              summary: null,
              definitionSnapshot: { name: "dev-patch", steps: [] },
              gitSha: null,
              gitDirty: null,
              inputs: { repo: "autoid-verify-service" },
              isInterrupted: false,
              articles: [],
              recommendationsCount: 0,
            },
          ],
          nextCursor: null,
        });
      }),
    );

    renderWorkflow("dev-patch");

    const row = await screen.findByRole("link", { name: /autoid-verify-service/i });
    expect(row.getAttribute("href")).toBe("/runs/r1");
    // The feed scoped its fetch to this workflow.
    expect(seenWorkflow).toEqual(["dev-patch"]);
  });

  it("renders a not-found view when the registry has no workflow with that name", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "other", steps: [] }])),
    );

    renderWorkflow("missing");

    expect(await screen.findByRole("heading", { name: /workflow not found/i })).toBeDefined();
    expect(screen.getByText("missing")).toBeDefined();
    expect(screen.getByRole("link", { name: /all activity/i }).getAttribute("href")).toBe("/");
  });

  it("renders a generic error view when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));

    renderWorkflow("kiri-self-review");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load workflow/i);
  });

  it("triggers a run and navigates to the run detail immediately on accept", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "kiri-self-review", steps: [{ sh: "echo ok" }] }]),
      ),
      http.post("*/api/workflows/:name/runs", ({ params }) =>
        HttpResponse.json(
          { runId: `run-${String(params.name)}-fresh`, status: "running" },
          { status: 202 },
        ),
      ),
    );

    const user = userEvent.setup();
    const { history } = renderWorkflow("kiri-self-review");

    await user.click(await screen.findByRole("button", { name: /^run/i }));

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-kiri-self-review-fresh");
    });
  });

  it("collects inputs via the modal and forwards them as the invoke body", async () => {
    const user = userEvent.setup();
    const seenBodies: string[] = [];
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          {
            name: "pr-review",
            inputs: [
              { name: "pr_number", description: "PR to review", required: true },
              { name: "owner", default: "kiri" },
            ],
            steps: [{ use: "claude-code" }],
          },
        ]),
      ),
      http.post("*/api/workflows/:name/runs", async ({ request, params }) => {
        seenBodies.push(await request.text());
        return HttpResponse.json(
          { runId: `run-${String(params.name)}-with-inputs`, status: "running" },
          { status: 202 },
        );
      }),
    );

    const { history } = renderWorkflow("pr-review");

    await user.click(await screen.findByRole("button", { name: /^run/i }));
    expect(screen.getByRole("dialog")).toBeDefined();

    await user.type(screen.getByLabelText(/pr_number/i), "42");
    await user.click(screen.getAllByRole("button", { name: /^run/i }).at(-1) as HTMLElement);

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/runs/run-pr-review-with-inputs");
    });
    expect(seenBodies).toEqual([JSON.stringify({ inputs: { pr_number: "42", owner: "kiri" } })]);
  });

  it("refetches when the matching workflow is updated", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json([{ name: "alpha", steps: [{ sh: `echo v${calls}` }] }]);
      }),
    );

    // The definition (and its sh: source labels) lives on the YAML tab, so
    // open the page there to observe the refetched step text.
    const { sources } = renderWorkflow("alpha", "/workflows/alpha?tab=yaml");
    await screen.findByText(/sh: echo v1/);

    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "alpha" });
    });

    await screen.findByText(/sh: echo v2/);
  });

  it("ignores workflow events for other names", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json([{ name: "alpha", steps: [{ sh: `echo v${calls}` }] }]);
      }),
    );

    const { sources } = renderWorkflow("alpha", "/workflows/alpha?tab=yaml");
    await screen.findByText(/sh: echo v1/);

    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "beta" });
      sources[0]?.emit({ type: "workflow.removed", name: "beta" });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText(/sh: echo v1/)).toBeDefined();
    expect(calls).toBe(1);
  });

  it("resolves a workflow whose name contains a slash from the percent-encoded URL", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "examples/recommendations", steps: [{ sh: "echo ok" }] }]),
      ),
    );

    // wouter passes the param value verbatim from the URL — slashes arrive
    // still percent-encoded because wouter uses `decodeURI`, which leaves
    // `%2F` alone. The page must decode before comparing against the API.
    const encoded = encodeURIComponent("examples/recommendations");
    const { sources } = renderWorkflow(encoded, `/workflows/${encoded}?tab=yaml`);

    expect(
      await screen.findByRole("heading", { level: 2, name: /examples\/recommendations/i }),
    ).toBeDefined();

    // Live events arrive with the raw (decoded) name; the filter must use
    // the decoded value too, otherwise edits never trigger a refetch.
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json([
          { name: "examples/recommendations", steps: [{ sh: `echo v${calls}` }] },
        ]);
      }),
    );

    act(() => {
      sources[0]?.emit({ type: "workflow.updated", name: "examples/recommendations" });
    });

    await screen.findByText(/sh: echo v1/);
  });

  it("falls back to the raw param when the URL contains a malformed escape", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "alpha", steps: [] }])),
    );

    // `%E0` is an incomplete UTF-8 byte and makes decodeURIComponent throw.
    // The route must still render (not crash) — typically as not-found.
    const malformed = "alpha%E0";
    renderWorkflow(malformed, `/workflows/${malformed}`);

    expect(await screen.findByRole("heading", { name: /workflow not found/i })).toBeDefined();
    expect(screen.getByText(malformed)).toBeDefined();
  });

  it("transitions to not-found when the matching workflow is removed", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json(calls === 1 ? [{ name: "alpha", steps: [{ sh: "echo a" }] }] : []);
      }),
    );

    const { sources } = renderWorkflow("alpha");
    await screen.findByRole("heading", { level: 2, name: /alpha/i });

    act(() => {
      sources[0]?.emit({ type: "workflow.removed", name: "alpha" });
    });

    await screen.findByRole("heading", { name: /workflow not found/i });
  });
});
