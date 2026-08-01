import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { FetchAllRepos } from "./fetch-all-repos.tsx";

const renderFetchAll = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FetchAllRepos />
    </QueryClientProvider>,
  );

const results = (...entries: Record<string, unknown>[]) =>
  http.post("*/api/git/fetch-all", () => HttpResponse.json({ results: entries }));

describe("<FetchAllRepos>", () => {
  it("names the repos that didn't succeed, with their reasons", async () => {
    server.use(
      results(
        { repo: "kiri", status: "updated", updates: ["   a..b  main -> origin/main"] },
        { repo: "quiet", status: "up-to-date", updates: [] },
        { repo: "offline", status: "failed", updates: [], error: "could not resolve host" },
        { repo: "local-only", status: "refused", updates: [], reason: "the repo has no remote" },
      ),
    );
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    // A repo that didn't fetch looks identical in the list to one that did, so
    // it has to say so rather than passing for "already up to date".
    expect(await screen.findByText("offline")).toBeDefined();
    expect(screen.getByText(/could not resolve host/i)).toBeDefined();
    expect(screen.getByText("local-only")).toBeDefined();
    expect(screen.getByText(/no remote/i)).toBeDefined();
    // Repos that fetched are not reported at all: what moved is on the cards.
    expect(screen.queryByText("kiri")).toBeNull();
    expect(screen.queryByText("quiet")).toBeNull();
  });

  it("reports nothing at all when every repo fetched", async () => {
    server.use(
      results(
        { repo: "kiri", status: "updated", updates: ["   a..b  main -> origin/main"] },
        { repo: "quiet", status: "up-to-date", updates: [] },
      ),
    );
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /fetching/i })).toBeNull());
    expect(screen.queryByText(/fetched/i)).toBeNull();
    expect(screen.queryByText("kiri")).toBeNull();
  });

  it("shows a pending state until the whole set settles", async () => {
    server.use(http.post("*/api/git/fetch-all", () => new Promise<Response>(() => {})));
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    expect(await screen.findByRole("button", { name: /fetching/i })).toBeDefined();
  });

  it("surfaces a failed request", async () => {
    server.use(http.post("*/api/git/fetch-all", () => new HttpResponse(null, { status: 500 })));
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    expect(await screen.findByText(/couldn't fetch/i)).toBeDefined();
  });
});
