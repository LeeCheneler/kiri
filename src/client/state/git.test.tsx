import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { useGitLive, useGitOverview } from "./git.ts";
import { createQueryClient } from "./query-client.ts";

const overview = (names: string[]) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: "2026-01-01T00:00:00.000Z",
  repos: names.map((name) => ({
    name,
    root: `/projects/${name}`,
    gitCommonDir: `/projects/${name}/.git`,
    worktrees: [],
  })),
});

const Probe = () => {
  useGitLive();
  const repos = useGitOverview().data?.repos ?? [];
  return <p>repos:{repos.length}</p>;
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
});
