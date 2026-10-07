import { beforeEach, describe, expect, it } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../tests/setup/flush-async.ts";
import { mockMermaid } from "../../tests/setup/mermaid-mock.tsx";
import { server } from "../../tests/setup/msw.ts";
import { mockReactVega } from "../../tests/setup/react-vega-mock.tsx";
import type { MemoryDetail } from "../shared/api/memories.ts";
import type { ProjectDetail, ProjectOverview } from "../shared/api/projects.ts";
import type { SessionDetail } from "../shared/api/sessions.ts";
import { App } from "./app.tsx";

mockReactVega();
mockMermaid();

const createdAt = "2026-05-09T12:00:00.000Z";
const project = { id: "project-123", name: "Research", instructions: null, createdAt };
const projectDetail = { project, articles: [], memories: [], sessions: [] } satisfies ProjectDetail;
const projectOverview = {
  project,
  memories: [],
  articleCount: 0,
  sessionCount: 0,
} satisfies ProjectOverview;
const workflow = { name: "daily-review", steps: [{ use: "check" }] };
const memory = {
  name: "server-record-name",
  description: "A saved preference",
  contentMd: "# Body heading must not become the memory title\n\nUse Bun.",
  createdAt,
  updatedAt: createdAt,
} satisfies MemoryDetail;

function sessionDetail(id: string, title: string | null): SessionDetail {
  return {
    transcriptRevision: 0,
    turnId: null,
    session: {
      id,
      title,
      status: "idle",
      model: "anthropic:claude",
      effort: "medium",
      projectId: null,
      transcriptRevision: 0,
      imageModel: null,
      cwd: null,
      parentSessionId: null,
      parentToolCallId: null,
      startedAt: createdAt,
      finishedAt: null,
      error: null,
    },
    messages: [],
    inbox: [],
    parent: null,
  };
}

function renderAt(path: string) {
  const location = memoryLocation({ path });
  const { factory, sources } = captureEventSources();
  render(
    <Router hook={location.hook}>
      <App liveEventsFactory={factory} />
    </Router>,
  );
  return { ...location, sources };
}

function expectTitle(title: string) {
  return waitFor(() => expect(document.title).toBe(title));
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const staticRoutes = [
  ["/", "Activity"],
  ["/workflows", "Workflows"],
  ["/mcp", "Tools & MCP"],
  ["/memories", "Memories"],
  ["/projects", "Projects"],
  ["/dev/design-system", "Design system"],
  ["/unknown-page", "Page not found"],
] as const;

const dynamicRoutes = [
  { path: "/sessions/session-123", endpoint: "*/api/sessions/:id", kind: "Session" },
  { path: "/projects/project-123", endpoint: "*/api/projects/:id/overview", kind: "Project" },
  { path: "/runs/abcd1234efgh", endpoint: "*/api/runs/:id", kind: "Run" },
  { path: "/workflows/daily-review", endpoint: "*/api/workflows", kind: "Workflow" },
  { path: "/memories/prefers-bun", endpoint: "*/api/memories/:name", kind: "Memory" },
  {
    path: "/projects/project-123/memories/deploy-window",
    endpoint: "*/api/projects/:id/memories/:name",
    kind: "Memory",
  },
  {
    path: "/runs/run-123/articles/report",
    endpoint: "*/api/runs/:id/articles/:slug",
    kind: "Article",
  },
  {
    path: "/sessions/session-123/articles/report",
    endpoint: "*/api/sessions/:id/articles/:slug",
    kind: "Article",
  },
  {
    path: "/projects/project-123/articles/report",
    endpoint: "*/api/projects/:id/articles/:slug",
    kind: "Article",
  },
] as const;

beforeEach(() => {
  document.title = "Kiri";
  server.use(
    http.get("*/api/memories", () => HttpResponse.json({ memories: [] })),
    http.get("*/api/projects", () => HttpResponse.json({ projects: [] })),
    http.get("*/api/mcp/tools", () => HttpResponse.json({ servers: [], builtin: [] })),
    http.get("*/api/projects/:id", () => HttpResponse.json(projectDetail)),
    http.get("*/api/projects/:id/articles", () =>
      HttpResponse.json({ articles: [], nextCursor: null }),
    ),
    http.get("*/api/projects/:id/sessions", () =>
      HttpResponse.json({ sessions: [], nextCursor: null }),
    ),
    http.get("*/api/sessions/:id/children", () => HttpResponse.json({ children: [] })),
    http.get("*/api/sessions/:id", ({ params }) =>
      HttpResponse.json(sessionDetail(String(params.id), "Writing session")),
    ),
  );
});

describe("contextual page titles", () => {
  it("replaces the hosted connection title when Activity opens", async () => {
    document.title = "Connect to Kiri";

    renderAt("/");

    await expectTitle("Activity · Kiri");
  });

  for (const [path, label] of staticRoutes) {
    it(`replaces the localhost title on ${path}`, async () => {
      renderAt(path);

      await expectTitle(`${label} · Kiri`);
      await flushAsync();
    });
  }

  for (const { path, endpoint, kind } of dynamicRoutes) {
    it(`uses ${kind} while ${path} is pending`, async () => {
      server.use(http.get(endpoint, () => new Promise<Response>(() => {})));
      document.title = "Previous page · Kiri";

      renderAt(path);

      expect(screen.getByText(new RegExp(`loading ${kind}`, "i"))).toBeDefined();
      await expectTitle(`${kind} · Kiri`);
    });

    for (const status of [500, 404]) {
      it(`keeps ${kind} when ${path} returns ${status}`, async () => {
        server.use(
          http.get(endpoint, () => HttpResponse.json({ error: "Load failed" }, { status })),
        );

        renderAt(path);

        if (status === 500 || kind === "Session" || kind === "Workflow") {
          await screen.findByRole("alert");
        } else {
          await screen.findByRole("heading", { name: `${kind} not found` });
        }
        await expectTitle(`${kind} · Kiri`);
      });
    }
  }

  for (const title of ["Investigation", null]) {
    it(`uses ${title === null ? "the short id for an untitled session" : "the loaded session title"}`, async () => {
      server.use(
        http.get("*/api/sessions/:id", () =>
          HttpResponse.json(sessionDetail("abcd1234-long-session", title)),
        ),
      );

      renderAt("/sessions/abcd1234-long-session");

      await expectTitle(`${title ?? "abcd1234"} · Kiri`);
    });
  }

  it("uses the loaded project name", async () => {
    server.use(http.get("*/api/projects/:id/overview", () => HttpResponse.json(projectOverview)));

    renderAt("/projects/project-123");

    await expectTitle("Research · Kiri");
  });

  it("uses the loaded workflow name", async () => {
    server.use(http.get("*/api/workflows", () => HttpResponse.json([workflow])));

    renderAt("/workflows/daily-review");

    await expectTitle("daily-review · Kiri");
  });

  it("keeps the workflow fallback when the loaded registry does not contain the route name", async () => {
    renderAt("/workflows/missing");

    await screen.findByRole("heading", { name: "Workflow not found" });
    await expectTitle("Workflow · Kiri");
  });

  for (const [path, endpoint, label] of [
    ["/memories/prefers-bun", "*/api/memories/:name", "prefers-bun"],
    [
      "/projects/project-123/memories/deploy-window",
      "*/api/projects/:id/memories/:name",
      "deploy-window",
    ],
  ]) {
    it(`uses the route memory name after ${path} loads`, async () => {
      server.use(http.get(endpoint, () => HttpResponse.json({ memory })));

      renderAt(path);

      await expectTitle(`${label} · Kiri`);
    });
  }

  it("combines the loaded run's workflow name and eight-character id", async () => {
    server.use(
      http.get("*/api/runs/:id", () =>
        HttpResponse.json({
          run: {
            id: "abcd1234efgh",
            workflowName: "daily-review",
            status: "ok",
            startedAt: createdAt,
            finishedAt: createdAt,
            error: null,
            summary: null,
            definitionSnapshot: workflow,
            gitSha: null,
            gitDirty: null,
            inputs: null,
            isInterrupted: false,
            articles: [],
            recommendationsCount: 0,
            recommendations: [],
          },
          steps: [],
        }),
      ),
    );

    renderAt("/runs/abcd1234efgh");

    await expectTitle("daily-review · abcd1234 · Kiri");
  });

  for (const { path, endpoint } of dynamicRoutes.filter((route) => route.kind === "Article")) {
    for (const [contentMd, expectedLabel] of [
      ["# Leading headline\n\nArticle body.", "Leading headline"],
      ["Article body without a heading.", "Saved report"],
      ["Opening prose.\n\n# Later heading\n\nMore prose.", "Later heading"],
      ["## Subheading\n\n```md\n# Code sample\n```", "Saved report"],
    ]) {
      it(`derives ${path}'s loaded title from ${JSON.stringify(contentMd)}`, async () => {
        server.use(
          http.get(endpoint, () =>
            HttpResponse.json({
              id: "article-123",
              projectId: path.startsWith("/sessions/") ? null : "project-123",
              sessionId: "session-123",
              sessionLabel: "Writing session",
              runId: "run-123",
              slug: "report",
              name: "Saved report",
              contentMd,
              createdAt,
              heading: "Stale server heading",
              workflowName: "daily-review",
              gitSha: null,
              gitDirty: null,
              startedAt: createdAt,
              finishedAt: createdAt,
            }),
          ),
        );

        renderAt(path);

        await expectTitle(`${expectedLabel} · Kiri`);
      });
    }
  }

  it("updates an async session title and then replaces it on navigation", async () => {
    const response = deferredResponse();
    server.use(http.get("*/api/sessions/:id", () => response.promise));
    const { navigate } = renderAt("/sessions/session-123");
    await expectTitle("Session · Kiri");

    response.resolve(HttpResponse.json(sessionDetail("session-123", "Loaded session")));
    await expectTitle("Loaded session · Kiri");

    act(() => navigate("/memories"));
    await expectTitle("Memories · Kiri");
  });

  it("does not let a late response overwrite the destination's title", async () => {
    const response = deferredResponse();
    let requested = false;
    server.use(
      http.get("*/api/sessions/:id", () => {
        requested = true;
        return response.promise;
      }),
    );
    const { navigate } = renderAt("/sessions/session-123");
    await waitFor(() => expect(requested).toBe(true));

    act(() => navigate("/workflows"));
    await expectTitle("Workflows · Kiri");
    await act(async () => {
      response.resolve(HttpResponse.json(sessionDetail("session-123", "Late session")));
      await flushAsync();
    });

    expect(document.title).toBe("Workflows · Kiri");
  });

  it("returns to the kind fallback when the same route component receives a new id", async () => {
    const secondResponse = deferredResponse();
    server.use(
      http.get("*/api/sessions/:id", ({ params }) =>
        params.id === "first-session"
          ? HttpResponse.json(sessionDetail("first-session", "First session"))
          : secondResponse.promise,
      ),
    );
    const { navigate } = renderAt("/sessions/first-session");
    await expectTitle("First session · Kiri");

    act(() => navigate("/sessions/second-session"));
    await expectTitle("Session · Kiri");
    secondResponse.resolve(HttpResponse.json(sessionDetail("second-session", "Second session")));

    await expectTitle("Second session · Kiri");
  });

  it("ignores the previous id's late response while the next session owns the title", async () => {
    const firstResponse = deferredResponse();
    let firstRequested = false;
    server.use(
      http.get("*/api/sessions/:id", ({ params }) => {
        if (params.id === "first-session") {
          firstRequested = true;
          return firstResponse.promise;
        }
        return HttpResponse.json(sessionDetail("second-session", "Second session"));
      }),
    );
    const { navigate } = renderAt("/sessions/first-session");
    await waitFor(() => expect(firstRequested).toBe(true));

    act(() => navigate("/sessions/second-session"));
    await expectTitle("Second session · Kiri");
    await act(async () => {
      firstResponse.resolve(
        HttpResponse.json(sessionDetail("first-session", "Late first session")),
      );
      await flushAsync();
    });

    expect(document.title).toBe("Second session · Kiri");
  });

  it("updates the title when live synchronization refreshes a renamed session", async () => {
    let title = "Investigation";
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail("session-123", title))),
    );
    const { sources } = renderAt("/sessions/session-123");
    await expectTitle("Investigation · Kiri");

    title = "Findings";
    act(() =>
      sources[0]?.emit({
        type: "session.updated",
        id: "session-123",
        status: "idle",
        projectId: null,
        parentSessionId: null,
      }),
    );

    await expectTitle("Findings · Kiri");
  });

  it("updates the title when live synchronization refreshes a renamed project", async () => {
    let name = "Research";
    server.use(
      http.get("*/api/projects/:id/overview", () =>
        HttpResponse.json({ ...projectOverview, project: { ...project, name } }),
      ),
    );
    const { sources } = renderAt("/projects/project-123");
    await expectTitle("Research · Kiri");

    name = "Writing";
    act(() => sources[0]?.emit({ type: "project.updated", id: project.id }));

    await expectTitle("Writing · Kiri");
  });
});
