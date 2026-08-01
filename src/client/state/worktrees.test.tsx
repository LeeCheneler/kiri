import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { createQueryClient } from "./query-client.ts";
import { useRefreshWorktrees, useWorktrees, useWorktreesLive } from "./worktrees.ts";

const overview = (names: string[]) => ({
  roots: ["/projects"],
  repos: names.map((name) => ({
    name,
    root: `/projects/${name}`,
    gitCommonDir: `/projects/${name}/.git`,
    worktrees: [],
  })),
});

const Probe = () => {
  useWorktreesLive();
  const refresh = useRefreshWorktrees();
  const repos = useWorktrees().data?.repos ?? [];
  return (
    <>
      <p>repos:{repos.length}</p>
      <button type="button" onClick={() => void refresh().catch(() => {})}>
        refresh
      </button>
    </>
  );
};

const renderProbe = () => {
  const { factory, sources } = captureEventSources();
  const rendered = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>
        <Probe />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, sources };
};

describe("worktrees state", () => {
  it("refetches the overview when discovery changes", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri"]))));
    const { sources } = renderProbe();
    expect(await screen.findByText("repos:1")).toBeDefined();

    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri", "site"]))));
    act(() => {
      sources[0]?.emit({ type: "git.changed" });
    });
    expect(await screen.findByText("repos:2")).toBeDefined();
  });

  it("re-runs discovery and reloads the overview on refresh", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri"]))));
    let refreshed = false;
    server.use(
      http.post("*/api/git/refresh", () => {
        refreshed = true;
        return HttpResponse.json(overview(["kiri", "site"]));
      }),
    );
    renderProbe();
    expect(await screen.findByText("repos:1")).toBeDefined();

    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri", "site"]))));
    await userEvent.click(screen.getByRole("button", { name: "refresh" }));
    expect(refreshed).toBe(true);
    expect(await screen.findByText("repos:2")).toBeDefined();
  });

  it("rejects when the refresh fails, leaving the cached overview in place", async () => {
    server.use(http.get("*/api/git", () => HttpResponse.json(overview(["kiri"]))));
    server.use(http.post("*/api/git/refresh", () => new HttpResponse(null, { status: 500 })));
    renderProbe();
    expect(await screen.findByText("repos:1")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "refresh" }));
    expect(screen.getByText("repos:1")).toBeDefined();
  });
});
