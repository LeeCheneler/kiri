import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
  it("counts what came back and lists only the repos with something to say", async () => {
    server.use(
      results(
        { repo: "kiri", status: "updated", updates: ["   a..b  main -> origin/main"] },
        { repo: "quiet", status: "up-to-date", updates: [] },
        { repo: "offline", status: "failed", updates: [], error: "could not resolve host" },
      ),
    );
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    expect(await screen.findByText(/fetched 3 repos/i)).toBeDefined();
    expect(screen.getByText(/1 updated, 1 already up to date, 1 failed/i)).toBeDefined();
    expect(screen.getByText("kiri")).toBeDefined();
    expect(screen.getByText("offline")).toBeDefined();
    expect(screen.getByText(/could not resolve host/i)).toBeDefined();
    // A repo with nothing to report is counted, not listed.
    expect(screen.queryByText("quiet")).toBeNull();
  });

  it("reports a fetch where nothing moved as a count alone", async () => {
    server.use(results({ repo: "kiri", status: "up-to-date", updates: [] }));
    renderFetchAll();

    await userEvent.click(screen.getByRole("button", { name: "Fetch all" }));

    expect(await screen.findByText(/fetched 1 repo/i)).toBeDefined();
    expect(screen.getByText(/1 already up to date/i)).toBeDefined();
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
