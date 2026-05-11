import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { ArtefactPage } from "./artefact-page.tsx";

afterEach(() => cleanup());

const NOW = new Date("2026-05-09T12:00:00.000Z");

const renderArtefact = (id: string, name: string) => {
  const { hook } = memoryLocation({ path: `/runs/${id}/published/${name}` });
  return render(
    <Router hook={hook}>
      <ArtefactPage params={{ id, name }} now={NOW} />
    </Router>,
  );
};

describe("<ArtefactPage>", () => {
  it("shows a loading message while the artefact is being fetched", () => {
    // A never-resolving handler keeps the page in the loading state while
    // we make the synchronous assertion. Avoids MSW's "no matching handler"
    // warning that the default-route fallback would otherwise emit.
    server.use(http.get("*/api/runs/:id/published/:name", () => new Promise(() => {})));
    renderArtefact("abc", "digest");
    expect(screen.getByText(/loading artefact/i)).toBeDefined();
  });

  it("renders the title, workflow, run link, created-at, and markdown body on the happy path", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", ({ params }) =>
        HttpResponse.json({
          id: "art-1",
          runId: params.id,
          name: params.name,
          title: "PR Review Digest",
          contentMd: "# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n",
          createdAt: new Date(NOW.getTime() - 30_000).toISOString(),
          workflowName: "pr-review",
        }),
      ),
    );

    renderArtefact("abc12345-0000-0000-0000-000000000000", "digest");

    expect(
      await screen.findByRole("heading", { level: 2, name: "PR Review Digest" }),
    ).toBeDefined();
    // The workflow name appears as kicker text above the title.
    expect(screen.getByText("pr-review")).toBeDefined();
    // The run-id chip links back to the run detail page.
    const runLink = screen.getByRole("link", { name: /^run abc12345$/i });
    expect(runLink.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    // Back link sits above the header.
    const backLink = screen.getByRole("link", { name: /back to run/i });
    expect(backLink.getAttribute("href")).toBe("/runs/abc12345-0000-0000-0000-000000000000");
    // Markdown body is rendered through ArtefactMarkdown — headings and
    // paragraphs both make it into the tree.
    expect(screen.getByRole("heading", { level: 1, name: "Hello" })).toBeDefined();
    expect(screen.getByText(/First paragraph\./)).toBeDefined();
    expect(screen.getByText(/Second paragraph\./)).toBeDefined();
  });

  it("renders the not-found view when the API returns 404", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", () =>
        HttpResponse.json({ error: "artefact not found" }, { status: 404 }),
      ),
    );

    renderArtefact("missing-run", "missing-art");

    expect(await screen.findByRole("heading", { name: /artefact not found/i })).toBeDefined();
    // The names are shown so the user can spot a typo in the URL.
    expect(screen.getByText("missing-run")).toBeDefined();
    expect(screen.getByText("missing-art")).toBeDefined();
    // Even on 404, the back link points at the run page rather than home —
    // the run might still exist; only the artefact is missing.
    const backLink = screen.getByRole("link", { name: /back to run/i });
    expect(backLink.getAttribute("href")).toBe("/runs/missing-run");
  });

  it("renders a generic error view on non-404 failures", async () => {
    server.use(
      http.get("*/api/runs/:id/published/:name", () => new HttpResponse("boom", { status: 500 })),
    );

    renderArtefact("abc", "digest");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load artefact/i);
  });

  it("ignores a stale response when params change mid-flight", async () => {
    // First request: never resolves — second request must still be the
    // one that paints. Without the token guard the late first response
    // would clobber the freshly-loaded second artefact.
    const responders: Array<(value: Response) => void> = [];
    server.use(
      http.get(
        "*/api/runs/:id/published/:name",
        ({ params }) =>
          new Promise<Response>((resolve) => {
            if (params.name === "first") {
              responders.push(resolve);
              return;
            }
            resolve(
              HttpResponse.json({
                id: "art-2",
                runId: params.id,
                name: params.name,
                title: "Second Artefact",
                contentMd: "second body\n",
                createdAt: NOW.toISOString(),
                workflowName: "wf",
              }),
            );
          }),
      ),
    );

    const { rerender } = renderArtefact("abc", "first");
    rerender(
      <Router hook={memoryLocation({ path: "/runs/abc/published/second" }).hook}>
        <ArtefactPage params={{ id: "abc", name: "second" }} now={NOW} />
      </Router>,
    );
    expect(await screen.findByRole("heading", { name: "Second Artefact" })).toBeDefined();

    // Late response for "first" — should be ignored.
    responders[0]?.(
      HttpResponse.json({
        id: "art-1",
        runId: "abc",
        name: "first",
        title: "First Artefact",
        contentMd: "stale\n",
        createdAt: NOW.toISOString(),
        workflowName: "wf",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("heading", { name: "First Artefact" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Second Artefact" })).toBeDefined();
  });
});
