import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { RecentArticles } from "./recent-articles.tsx";

// A fixed clock so relative times render deterministically.
const NOW = new Date("2026-05-09T12:03:00.000Z");

const article = (over: Record<string, unknown> = {}) => ({
  runId: "run-1",
  name: "briefing",
  title: "Morning Briefing",
  heading: "Top of the morning",
  workflowName: "briefing",
  createdAt: "2026-05-09T12:00:00.000Z",
  ...over,
});

const renderRail = () =>
  render(
    <Router hook={memoryLocation({ path: "/" }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <RecentArticles now={NOW} />
      </QueryClientProvider>
    </Router>,
  );

describe("<RecentArticles>", () => {
  it("shows a loading message under the heading until the list resolves", () => {
    server.use(http.get("*/api/articles/recent", () => new Promise(() => {})));
    renderRail();
    expect(screen.getByRole("heading", { name: /recently published/i })).toBeDefined();
    expect(screen.getByText(/loading articles/i)).toBeDefined();
  });

  it("surfaces a fetch failure via an alert", async () => {
    server.use(http.get("*/api/articles/recent", () => new HttpResponse("boom", { status: 500 })));
    renderRail();
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("alert").textContent).toMatch(/failed to load articles/i);
  });

  it("shows the empty state when nothing has been published", async () => {
    server.use(http.get("*/api/articles/recent", () => HttpResponse.json([])));
    renderRail();
    expect(await screen.findByText(/nothing published yet/i)).toBeDefined();
  });

  it("links each article to its reading page and names its workflow", async () => {
    server.use(
      http.get("*/api/articles/recent", () =>
        HttpResponse.json([
          article({ runId: "run-1", name: "a", heading: "First Heading", workflowName: "alpha" }),
          article({
            runId: "run-2",
            name: "b",
            heading: null,
            title: "Second Title",
            workflowName: "beta",
          }),
        ]),
      ),
    );
    renderRail();

    const first = await screen.findByRole("link", { name: /first heading/i });
    expect(first.getAttribute("href")).toBe("/runs/run-1/published/a");
    // A null heading falls back to the article's title for the link label.
    const second = screen.getByRole("link", { name: /second title/i });
    expect(second.getAttribute("href")).toBe("/runs/run-2/published/b");

    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("beta")).toBeDefined();
  });
});
