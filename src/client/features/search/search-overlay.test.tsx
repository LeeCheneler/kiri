import { describe, expect, it, mock } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SearchOverlay } from "./search-overlay.tsx";

const emptyResults = { articles: [], sessions: [], runs: [], workflows: [] };

const fullResults = {
  articles: [
    {
      id: "a1",
      slug: "digest",
      name: "Pelican Digest",
      runId: "r1",
      sessionId: null,
      snippet: [
        { text: "All the ", match: false },
        { text: "pelican", match: true },
        { text: " news.", match: false },
      ],
    },
    {
      id: "a2",
      slug: "notes",
      name: "Session Notes",
      runId: null,
      sessionId: "s9",
      snippet: [{ text: "pelican", match: true }],
    },
  ],
  sessions: [
    {
      id: "s1",
      title: null,
      preview: "Tell me about pelicans",
      snippet: [{ text: "pelicans", match: true }],
    },
    { id: "s2", title: null, preview: "", snippet: [{ text: "pelican", match: true }] },
    {
      id: "s3",
      title: "Pelican migration plan",
      preview: "Where do pelicans go",
      snippet: [{ text: "pelican", match: true }],
    },
  ],
  runs: [
    {
      id: "r1",
      workflowName: "news-digest",
      snippet: [{ text: "pelican stories", match: false }],
    },
  ],
  workflows: [{ name: "pelican-digest", description: "Gathers pelican news" }],
};

const renderOverlay = (onClose = () => {}) => {
  const memory = memoryLocation({ path: "/", record: true });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <SearchOverlay onClose={onClose} />
      </Router>
    </QueryClientProvider>,
  );
  return { history: memory.history };
};

const searchBox = () => screen.getByRole("textbox", { name: "Search" }) as HTMLInputElement;

describe("<SearchOverlay>", () => {
  it("shows a hint and fires no query while the box is blank", () => {
    let requests = 0;
    server.use(
      http.get("*/api/search", () => {
        requests += 1;
        return HttpResponse.json(emptyResults);
      }),
    );
    renderOverlay();
    expect(screen.getByText(/type to search/i)).toBeDefined();
    expect(requests).toBe(0);
  });

  it("queries the debounced term and renders grouped results", async () => {
    const terms: string[] = [];
    server.use(
      http.get("*/api/search", ({ request }) => {
        terms.push(new URL(request.url).searchParams.get("q") ?? "");
        return HttpResponse.json(fullResults);
      }),
    );
    renderOverlay();

    await userEvent.type(searchBox(), "pelican");

    expect(await screen.findByText("Articles")).toBeDefined();
    expect(screen.getByText("Sessions")).toBeDefined();
    expect(screen.getByText("Runs")).toBeDefined();
    expect(screen.getByText("Workflows")).toBeDefined();

    // Keystrokes inside the debounce window collapse into one request.
    expect(terms).toEqual(["pelican"]);

    expect(screen.getByRole("link", { name: /pelican digest/i }).getAttribute("href")).toBe(
      "/runs/r1/articles/digest",
    );
    expect(screen.getByRole("link", { name: /session notes/i }).getAttribute("href")).toBe(
      "/sessions/s9/articles/notes",
    );
    expect(screen.getByRole("link", { name: /tell me about pelicans/i }).getAttribute("href")).toBe(
      "/sessions/s1",
    );
    expect(screen.getByRole("link", { name: /untitled session/i }).getAttribute("href")).toBe(
      "/sessions/s2",
    );
    // A titled session leads with its title, not its first-message preview.
    expect(screen.getByRole("link", { name: /pelican migration plan/i }).getAttribute("href")).toBe(
      "/sessions/s3",
    );
    expect(screen.queryByText(/where do pelicans go/i)).toBeNull();
    expect(screen.getByRole("link", { name: /news-digest/i }).getAttribute("href")).toBe(
      "/runs/r1",
    );
    expect(screen.getByRole("link", { name: /pelican-digest/i }).getAttribute("href")).toBe(
      "/workflows/pelican-digest",
    );
  });

  it("marks the matched snippet segments", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(fullResults)));
    renderOverlay();

    await userEvent.type(searchBox(), "pelican");
    await screen.findByText("Articles");

    // Matched segments render as <mark>; the surrounding prose does not.
    expect(screen.getAllByText("pelican", { selector: "mark" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/all the/i, { selector: "mark" })).toBeNull();
  });

  it("shows an empty state when nothing matches", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(emptyResults)));
    renderOverlay();

    await userEvent.type(searchBox(), "ghost");
    expect(await screen.findByText(/no results for “ghost”/i)).toBeDefined();
  });

  it("shows an error notice when the query fails", async () => {
    server.use(http.get("*/api/search", () => new HttpResponse(null, { status: 500 })));
    renderOverlay();

    await userEvent.type(searchBox(), "pelican");
    expect(await screen.findByText(/search failed/i)).toBeDefined();
  });

  it("walks the results with the arrow keys and returns to the input", async () => {
    server.use(http.get("*/api/search", () => HttpResponse.json(fullResults)));
    renderOverlay();

    await userEvent.type(searchBox(), "pelican");
    await screen.findByText("Articles");

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /pelican digest/i }));

    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("link", { name: /session notes/i }));

    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(searchBox());
  });

  it("opens a result and closes the overlay", async () => {
    const onClose = mock(() => {});
    server.use(http.get("*/api/search", () => HttpResponse.json(fullResults)));
    const { history } = renderOverlay(onClose);

    await userEvent.type(searchBox(), "pelican");
    await userEvent.click(await screen.findByRole("link", { name: /tell me about pelicans/i }));

    await waitFor(() => expect(history.at(-1)).toBe("/sessions/s1"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
