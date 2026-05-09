import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../tests/setup/msw.ts";
import { PageShell } from "./page-shell.tsx";

afterEach(() => cleanup());

const renderShell = (children: ReactNode, path = "/") => {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <PageShell>{children}</PageShell>
    </Router>,
  );
};

describe("<PageShell>", () => {
  it("renders children inside the main landmark", () => {
    renderShell(<p>route content here</p>);
    expect(screen.getByRole("main").textContent).toContain("route content here");
  });

  it("renders a kiri wordmark linking back to the dashboard", () => {
    renderShell(<p>x</p>);
    const wordmark = screen.getByRole("link", { name: /kiri/i });
    expect(wordmark.getAttribute("href")).toBe("/");
  });

  it("renders the workflows nav once the registry resolves", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "alpha", steps: [] } satisfies { name: string; steps: [] }]),
      ),
    );

    renderShell(<p>x</p>);

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /workflows/i })).toBeDefined();
    });
    expect(screen.getByRole("link", { name: /alpha/i }).getAttribute("href")).toBe(
      "/workflows/alpha",
    );
  });

  it("falls through to the empty-state nav copy when the registry is empty", async () => {
    renderShell(<p>x</p>);
    expect(await screen.findByText(/no workflows yet/i)).toBeDefined();
  });

  it("highlights the workflow that matches the current location", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([
          { name: "alpha", steps: [] },
          { name: "beta", steps: [] },
        ]),
      ),
    );

    renderShell(<p>x</p>, "/workflows/beta");

    const beta = await screen.findByRole("link", { name: /beta/i });
    expect(beta.getAttribute("aria-current")).toBe("page");
    const alpha = screen.getByRole("link", { name: /alpha/i });
    expect(alpha.getAttribute("aria-current")).toBeNull();
  });

  it("decodes percent-encoded names from the URL when matching the active row", async () => {
    server.use(
      http.get("*/api/workflows", () =>
        HttpResponse.json([{ name: "flow with space", steps: [] }]),
      ),
    );

    renderShell(<p>x</p>, "/workflows/flow%20with%20space");

    const link = await screen.findByRole("link", { name: /flow with space/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("falls back to the raw segment if the location has malformed escapes", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "alpha%ZZ", steps: [] }])),
    );

    renderShell(<p>x</p>, "/workflows/alpha%ZZ");

    const link = await screen.findByRole("link", { name: /alpha%ZZ/i });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("hides the workflows nav when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));

    renderShell(<p>x</p>);

    // Wait long enough for the rejected fetch to have settled.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("navigation", { name: /workflows/i })).toBeNull();
    expect(screen.queryByText(/no workflows yet/i)).toBeNull();
  });
});
