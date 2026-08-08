import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import {
  useCreateProject,
  useDeleteProject,
  useProject,
  useProjectArticle,
  useProjects,
  useProjectsLive,
  useRenameProject,
} from "./projects.ts";
import { createQueryClient } from "./query-client.ts";

const summary = (id: string, name = "Research") => ({
  id,
  name,
  createdAt: "2026-08-07T10:00:00.000Z",
  articleCount: 0,
  sessionCount: 0,
});

const detail = (id: string, name = "Research") => ({
  project: { id, name, createdAt: "2026-08-07T10:00:00.000Z" },
  articles: [],
  sessions: [],
});

const article = (projectId: string, contentMd = "# Doc\n\nBody.") => ({
  id: "a1",
  projectId,
  slug: "corpus-doc",
  name: "Doc",
  contentMd,
  createdAt: "2026-08-07T10:00:00.000Z",
  heading: "Doc",
});

const ListProbe = () => {
  useProjectsLive();
  const projects = useProjects().data ?? [];
  return <p>projects:{projects.map((project) => project.name).join(",")}</p>;
};

const DetailProbe = ({ id }: { id: string }) => {
  useProjectsLive();
  const project = useProject(id).data;
  return <p>name:{project?.project.name ?? "none"}</p>;
};

const ArticleProbe = ({ id }: { id: string }) => {
  useProjectsLive();
  const data = useProjectArticle(id, "corpus-doc").data;
  return <p>body:{data?.contentMd ?? "none"}</p>;
};

const MutateProbe = () => {
  const create = useCreateProject();
  const rename = useRenameProject();
  const remove = useDeleteProject();
  const projects = useProjects().data ?? [];
  return (
    <div>
      <p>projects:{projects.map((project) => project.name).join(",")}</p>
      <button type="button" onClick={() => void create("Research")}>
        create
      </button>
      <button type="button" onClick={() => void rename("p1", "Renamed")}>
        rename
      </button>
      <button type="button" onClick={() => void remove("p1")}>
        delete
      </button>
    </div>
  );
};

const renderProbe = (ui: React.ReactNode) => {
  const { factory, sources } = captureEventSources();
  const rendered = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, sources };
};

describe("projects state", () => {
  it("refetches the index when a project is created elsewhere", async () => {
    server.use(
      http.get("*/api/projects", () => HttpResponse.json({ projects: [summary("p1", "Alpha")] })),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("projects:Alpha")).toBeDefined();

    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: [summary("p1", "Alpha"), summary("p2", "Beta")] }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "project.created", id: "p2" });
    });
    expect(await screen.findByText("projects:Alpha,Beta")).toBeDefined();
  });

  it("refetches a mounted detail on rename, and re-syncs on reconnect", async () => {
    server.use(http.get("*/api/projects/p1", () => HttpResponse.json(detail("p1", "Old Name"))));
    const { sources } = renderProbe(<DetailProbe id="p1" />);
    expect(await screen.findByText("name:Old Name")).toBeDefined();

    server.use(http.get("*/api/projects/p1", () => HttpResponse.json(detail("p1", "New Name"))));
    act(() => {
      sources[0]?.emit({ type: "project.updated", id: "p1" });
    });
    expect(await screen.findByText("name:New Name")).toBeDefined();

    server.use(http.get("*/api/projects/p1", () => HttpResponse.json(detail("p1", "Reconnected"))));
    // The first open is the initial connect; the second is a reconnect, which
    // must re-sync anything missed while disconnected.
    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());
    expect(await screen.findByText("name:Reconnected")).toBeDefined();
  });

  it("refetches a mounted project article when its project changes", async () => {
    server.use(
      http.get("*/api/projects/p1/articles/corpus-doc", () =>
        HttpResponse.json(article("p1", "Old body.")),
      ),
    );
    const { sources } = renderProbe(<ArticleProbe id="p1" />);
    expect(await screen.findByText("body:Old body.")).toBeDefined();

    server.use(
      http.get("*/api/projects/p1/articles/corpus-doc", () =>
        HttpResponse.json(article("p1", "New body.")),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "project.updated", id: "p1" });
    });
    expect(await screen.findByText("body:New body.")).toBeDefined();
  });

  it("drops a deleted project from a mounted index", async () => {
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: [summary("p1", "Alpha"), summary("p2", "Doomed")] }),
      ),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("projects:Alpha,Doomed")).toBeDefined();

    server.use(
      http.get("*/api/projects", () => HttpResponse.json({ projects: [summary("p1", "Alpha")] })),
    );
    act(() => {
      sources[0]?.emit({ type: "project.deleted", id: "p2" });
    });
    expect(await screen.findByText("projects:Alpha")).toBeDefined();
  });

  it("creates a project, returns its id, and refetches the index", async () => {
    let created = false;
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: created ? [summary("p1")] : [] }),
      ),
      http.post("*/api/projects", () => {
        created = true;
        return HttpResponse.json(
          { project: { id: "p1", name: "Research", createdAt: "2026-08-07T10:00:00.000Z" } },
          { status: 201 },
        );
      }),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("projects:")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByText("projects:Research")).toBeDefined();
  });

  it("writes a rename then refetches from the server's truth", async () => {
    let patched: unknown = null;
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: [summary("p1", patched ? "Renamed" : "Research")] }),
      ),
      http.patch("*/api/projects/p1", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({
          project: { id: "p1", name: "Renamed", createdAt: "2026-08-07T10:00:00.000Z" },
        });
      }),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("projects:Research")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "rename" }));

    expect(patched).toEqual({ name: "Renamed" });
    expect(await screen.findByText("projects:Renamed")).toBeDefined();
  });

  it("deletes a project then refetches the index", async () => {
    let deleted = false;
    server.use(
      http.get("*/api/projects", () =>
        HttpResponse.json({ projects: deleted ? [] : [summary("p1")] }),
      ),
      http.delete("*/api/projects/p1", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("projects:Research")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "delete" }));

    expect(await screen.findByText("projects:")).toBeDefined();
    expect(deleted).toBe(true);
  });
});
