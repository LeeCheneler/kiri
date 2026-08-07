import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { MemoriesList } from "./memories-list.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const summary = (name: string, description: string) => ({
  name,
  description,
  updatedAt: "2026-08-07T10:00:00.000Z",
});

const serveMemories = (memories: unknown[]) =>
  server.use(http.get("*/api/memories", () => HttpResponse.json({ memories })));

const renderList = () =>
  render(
    <Router hook={memoryLocation({ path: "/memories" }).hook}>
      <QueryClientProvider client={createQueryClient()}>
        <MemoriesList now={NOW} />
      </QueryClientProvider>
    </Router>,
  );

describe("<MemoriesList>", () => {
  it("lists each memory as a link with its summary", async () => {
    serveMemories([
      summary("prefers-bun", "Prefers bun over node."),
      summary("release-style", "Groups release notes by feature."),
    ]);
    renderList();

    const link = await screen.findByRole("link", { name: "prefers-bun" });
    expect(link.getAttribute("href")).toBe("/memories/prefers-bun");
    expect(screen.getByText("Prefers bun over node.")).toBeDefined();
    expect(screen.getByRole("link", { name: "release-style" })).toBeDefined();
  });

  it("filters by name and description", async () => {
    serveMemories([
      summary("prefers-bun", "Prefers bun over node."),
      summary("release-style", "Groups release notes by feature."),
    ]);
    renderList();
    await screen.findByRole("link", { name: "prefers-bun" });

    await userEvent.type(screen.getByPlaceholderText("Filter memories…"), "release notes");

    expect(screen.queryByRole("link", { name: "prefers-bun" })).toBeNull();
    expect(screen.getByRole("link", { name: "release-style" })).toBeDefined();
  });

  it("reports when nothing matches the filter", async () => {
    serveMemories([summary("prefers-bun", "Prefers bun over node.")]);
    renderList();
    await screen.findByRole("link", { name: "prefers-bun" });

    await userEvent.type(screen.getByPlaceholderText("Filter memories…"), "zzz");

    expect(screen.getByText(/no memories match/i)).toBeDefined();
  });

  it("explains the feature when no memories exist", async () => {
    serveMemories([]);
    renderList();

    expect(await screen.findByText(/no memories yet/i)).toBeDefined();
  });

  it("surfaces an error when the index fails to load", async () => {
    server.use(http.get("*/api/memories", () => new HttpResponse("boom", { status: 500 })));
    renderList();

    expect(await screen.findByRole("alert")).toBeDefined();
  });
});
