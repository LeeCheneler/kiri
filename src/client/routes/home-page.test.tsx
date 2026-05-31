import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { createQueryClient } from "../state/query-client.ts";
import { HomeContent } from "./home-page.tsx";

const renderHomePage = () => {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={hook}>
        <HomeContent />
      </Router>
    </QueryClientProvider>,
  );
};

describe("<HomePage>", () => {
  it("anchors the page on the Activity breadcrumb", async () => {
    server.use(http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })));
    renderHomePage();
    const current = screen.getByText("Activity");
    expect(current.getAttribute("aria-current")).toBe("page");
    await flushAsync();
  });

  it("composes the activity feed below the breadcrumb", async () => {
    server.use(http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })));
    renderHomePage();
    expect(await screen.findByText(/no runs yet/i)).toBeDefined();
  });
});
