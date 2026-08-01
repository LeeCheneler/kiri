import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import type { Changeset, ChangesetFile } from "../../api.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { ChangesDetail } from "./changes-detail.tsx";

const worktree = (overrides: Record<string, unknown> = {}) => ({
  path: "/projects/kiri",
  branch: "main",
  detached: false,
  head: "abc1234",
  dirty: false,
  ahead: 0,
  behind: 0,
  upstreamGone: false,
  locked: false,
  prunable: false,
  primary: false,
  ...overrides,
});

const overview = (repos: unknown[]) => ({
  roots: ["/projects"],
  refreshing: false,
  scannedAt: new Date().toISOString(),
  repos,
});

const kiri = (overrides: Record<string, unknown> = {}) => ({
  name: "kiri",
  root: "/projects/kiri",
  gitCommonDir: "/projects/kiri/.git",
  defaultBranch: "main",
  worktrees: [
    worktree({ primary: true }),
    worktree({ path: "/projects/kiri-feat-search", branch: "feat/search" }),
  ],
  ...overrides,
});

const file = (overrides: Partial<ChangesetFile> = {}): ChangesetFile => ({
  path: "src/app.ts",
  previousPath: null,
  kind: "modified",
  insertions: 4,
  deletions: 2,
  binary: false,
  ...overrides,
});

const changeset = (overrides: Partial<Changeset> = {}): Changeset => ({
  view: "uncommitted",
  files: [file()],
  totalFiles: 1,
  truncated: false,
  mergeBase: null,
  emptyReason: null,
  ...overrides,
});

const PATCH = ["@@ -1,2 +1,2 @@ export function app()", "-was here", "+is here"].join("\n");

type PatchResult = { path: string; patch: string; truncated: boolean };

// Serve the overview plus both changeset endpoints, each overridable.
const serve = (
  options: {
    repos?: unknown[];
    list?: (query: URLSearchParams) => Changeset | Response;
    patch?: (query: URLSearchParams) => PatchResult | Response;
  } = {},
) => {
  server.use(
    http.get("*/api/git", () => HttpResponse.json(overview(options.repos ?? [kiri()]))),
    http.get("*/api/git/changeset", ({ request }) => {
      const query = new URL(request.url).searchParams;
      const result = options.list?.(query) ?? changeset();
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
    http.get("*/api/git/changeset/patch", ({ request }) => {
      const query = new URL(request.url).searchParams;
      const result = options.patch?.(query) ?? {
        path: query.get("file") ?? "",
        patch: PATCH,
        truncated: false,
      };
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
};

const renderDetail = ({
  repo = "kiri",
  checkout = "kiri",
  search = "",
}: { repo?: string; checkout?: string; search?: string } = {}) => {
  const location = memoryLocation({
    path: `/git/${repo}/changes/${checkout}`,
    searchPath: search,
    record: true,
  });
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <QueryClientProvider client={createQueryClient()}>
        <ChangesDetail repo={repo} checkout={checkout} />
      </QueryClientProvider>
    </Router>,
  );
  return location;
};

describe("<ChangesDetail>", () => {
  it("shows a loading state while the overview is in flight", () => {
    server.use(http.get("*/api/git", () => new Promise<Response>(() => {})));
    renderDetail();
    expect(screen.getByText(/loading checkout/i)).toBeDefined();
  });

  it("shows an error notice when the overview fails to load", async () => {
    server.use(http.get("*/api/git", () => new HttpResponse(null, { status: 500 })));
    renderDetail();
    expect(await screen.findByText(/couldn't load checkout/i)).toBeDefined();
  });

  it("renders a not-found state for a checkout the scan doesn't hold", async () => {
    serve();
    renderDetail({ checkout: "kiri-gone" });
    expect(await screen.findByText(/checkout not found/i)).toBeDefined();
    expect(screen.getByText("kiri-gone")).toBeDefined();
  });

  it("heads the page with the checkout's branch, state, and path", async () => {
    serve();
    renderDetail({ checkout: "kiri-feat-search" });

    expect(await screen.findByText("feat/search")).toBeDefined();
    expect(screen.getByText("clean")).toBeDefined();
    expect(screen.getByText("/projects/kiri-feat-search")).toBeDefined();
  });

  it("lists what changed with its kind and line counts", async () => {
    serve();
    renderDetail();

    expect(await screen.findByText("src/app.ts")).toBeDefined();
    expect(screen.getByText("modified")).toBeDefined();
    expect(screen.getByText("+4 −2")).toBeDefined();
  });

  it("reads the checkout the route names rather than the repo's primary", async () => {
    const paths: string[] = [];
    serve({
      list: (query) => {
        paths.push(query.get("path") ?? "");
        return changeset({ files: [] });
      },
    });
    renderDetail({ checkout: "kiri-feat-search" });
    await waitFor(() => expect(paths).toEqual(["/projects/kiri-feat-search"]));
  });

  it("loads a file's patch only once that file is picked", async () => {
    const asked: string[] = [];
    serve({
      patch: (query) => {
        const name = query.get("file") ?? "";
        asked.push(name);
        return { path: name, patch: PATCH, truncated: false };
      },
    });
    renderDetail();

    expect(await screen.findByText(/pick a file/i)).toBeDefined();
    expect(asked).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText("is here")).toBeDefined();
    expect(asked).toEqual(["src/app.ts"]);
    expect(screen.getByText("was here")).toBeDefined();
  });

  it("shows a loading state while a file's diff is being computed", async () => {
    serve();
    server.use(http.get("*/api/git/changeset/patch", () => new Promise<Response>(() => {})));
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText(/computing this file's diff/i)).toBeDefined();
  });

  it("surfaces a failure to compute a file's diff", async () => {
    serve({ patch: () => new HttpResponse(null, { status: 500 }) });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText(/couldn't load this file's diff/i)).toBeDefined();
  });

  it("says so when a file has no diff in this view rather than showing an empty panel", async () => {
    serve({ patch: (query) => ({ path: query.get("file") ?? "", patch: "", truncated: false }) });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText(/no diff for this file/i)).toBeDefined();
  });

  it("notes a patch the server cut short without repeating its marker", async () => {
    serve({
      patch: (query) => ({
        path: query.get("file") ?? "",
        patch: `${PATCH}\n... patch truncated\n`,
        truncated: true,
      }),
    });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /src\/app\.ts/ }));
    expect(await screen.findByText("… diff truncated")).toBeDefined();
    expect(screen.queryByText("... patch truncated")).toBeNull();
  });

  it("offers no diff for a binary file and says why", async () => {
    serve({ list: () => changeset({ files: [file({ path: "logo.png", binary: true })] }) });
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: /logo\.png/ }));
    expect(await screen.findByText(/no lines to diff/i)).toBeDefined();
    expect(screen.getByText("binary")).toBeDefined();
  });

  it("names the path a renamed file moved from", async () => {
    serve({
      list: () =>
        changeset({
          files: [file({ path: "src/new.ts", previousPath: "src/old.ts", kind: "renamed" })],
        }),
    });
    renderDetail();
    expect(await screen.findByText(/from src\/old\.ts/)).toBeDefined();
  });

  it("says the list was capped and how much was left out", async () => {
    serve({ list: () => changeset({ totalFiles: 900, truncated: true }) });
    renderDetail();
    expect(await screen.findByText(/showing 1 of 900 changed files/i)).toBeDefined();
  });

  it("opens straight on the branch view when the URL asks for it", async () => {
    const views: string[] = [];
    serve({
      list: (query) => {
        views.push(query.get("view") ?? "");
        return changeset({ view: "branch", files: [] });
      },
    });
    renderDetail({ checkout: "kiri-feat-search", search: "view=branch" });

    await waitFor(() => expect(views).toEqual(["branch"]));
    expect(screen.getByRole("radio", { name: "Branch" })).toHaveProperty("checked", true);
  });

  it("reads the working tree for a view the URL doesn't recognise", async () => {
    const views: string[] = [];
    serve({
      list: (query) => {
        views.push(query.get("view") ?? "");
        return changeset({ files: [] });
      },
    });
    renderDetail({ search: "view=staged" });
    await waitFor(() => expect(views).toEqual(["uncommitted"]));
  });

  it("puts the chosen view in the URL so it can be linked to", async () => {
    serve({
      list: (query) =>
        query.get("view") === "branch" ? changeset({ view: "branch", files: [] }) : changeset(),
    });
    const location = renderDetail({ checkout: "kiri-feat-search" });

    expect(await screen.findByText("src/app.ts")).toBeDefined();
    await userEvent.click(screen.getByRole("radio", { name: "Branch" }));

    expect(await screen.findByText(/introduces nothing over main/i)).toBeDefined();
    expect(location.history.at(-1)).toContain("view=branch");

    await userEvent.click(screen.getByRole("radio", { name: "Uncommitted" }));
    await waitFor(() => expect(location.history.at(-1)).not.toContain("view=branch"));
  });

  it("says the working tree is clean when the uncommitted view is empty", async () => {
    serve({ list: () => changeset({ files: [] }) });
    renderDetail();
    expect(await screen.findByText(/working tree is clean/i)).toBeDefined();
  });

  it("names the default branch generically when the repo has none", async () => {
    serve({
      repos: [kiri({ defaultBranch: null })],
      list: () => changeset({ view: "branch", files: [] }),
    });
    renderDetail({ search: "view=branch" });
    expect(await screen.findByText(/introduces nothing over the default branch/i)).toBeDefined();
  });

  it.each([
    ["no-default-branch", /no default branch to measure a branch against/i],
    ["on-default-branch", /nothing it introduces over it/i],
    ["no-merge-base", /no commit the two have in common/i],
    ["no-commits", /no commits yet/i],
  ] as const)("explains the %s case in words rather than a code", async (reason, sentence) => {
    serve({ list: () => changeset({ files: [], emptyReason: reason }) });
    renderDetail();
    expect(await screen.findByText(sentence)).toBeDefined();
  });

  it("recomputes on request rather than polling", async () => {
    let reads = 0;
    serve({
      list: () => {
        reads += 1;
        return changeset({ files: [] });
      },
    });
    renderDetail();

    await waitFor(() => expect(reads).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Recompute" }));
    await waitFor(() => expect(reads).toBe(2));
  });

  it("surfaces a failure to read what changed", async () => {
    serve({ list: () => new HttpResponse(null, { status: 500 }) });
    renderDetail();
    expect(await screen.findByText(/couldn't read what changed/i)).toBeDefined();
  });

  it("shows a loading state while the changeset is in flight", async () => {
    serve();
    server.use(http.get("*/api/git/changeset", () => new Promise<Response>(() => {})));
    renderDetail();
    expect(await screen.findByText(/working out what changed/i)).toBeDefined();
  });
});
