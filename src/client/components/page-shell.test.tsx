import { afterEach, describe, expect, it } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import { PageShell } from "./page-shell.tsx";

afterEach(() => cleanup());

const renderShell = (children: ReactNode, path = "/", rightAside?: ReactNode) => {
  const { hook } = memoryLocation({ path });
  const { factory, sources } = captureEventSources();
  const ui = render(
    <Router hook={hook}>
      <LiveEventsProvider factory={factory}>
        <PageShell rightAside={rightAside}>{children}</PageShell>
      </LiveEventsProvider>
    </Router>,
  );
  return { ...ui, sources };
};

describe("<PageShell>", () => {
  it("renders children inside the main landmark", async () => {
    renderShell(<p>route content here</p>);
    expect(screen.getByRole("main").textContent).toContain("route content here");
    await flushAsync();
  });

  it("renders a kiri wordmark linking back to the dashboard", async () => {
    renderShell(<p>x</p>);
    const wordmark = screen.getByRole("link", { name: /kiri/i });
    expect(wordmark.getAttribute("href")).toBe("/");
    await flushAsync();
  });

  it("renders a documentation link that opens the hosted docs in a new tab", async () => {
    renderShell(<p>x</p>);
    const docsNav = screen.getByRole("navigation", { name: /docs/i });
    expect(docsNav).toBeDefined();
    const link = screen.getByRole("link", { name: /documentation/i });
    expect(link.getAttribute("href")).toBe("https://local.kiri.build/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    const rel = link.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    await flushAsync();
  });

  it("renders the caller-supplied right aside in the right rail", async () => {
    renderShell(<p>x</p>, "/", <nav aria-label="right rail marker">aside content</nav>);
    expect(screen.getByRole("navigation", { name: /right rail marker/i })).toBeDefined();
    await flushAsync();
  });

  it("leaves the right rail empty when no rightAside is supplied", async () => {
    renderShell(<p>x</p>);
    // No default marginalia — the article and other routes choose what to
    // pass. Recently Published only renders when a caller provides it.
    expect(screen.queryByRole("heading", { name: /recently published/i })).toBeNull();
    await flushAsync();
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
    await flushAsync();
  });

  it("falls through to the empty-state nav copy when the registry is empty", async () => {
    renderShell(<p>x</p>);
    expect(await screen.findByText(/no workflows yet/i)).toBeDefined();
    await flushAsync();
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
    await flushAsync();
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
    await flushAsync();
  });

  it("falls back to the raw segment if the location has malformed escapes", async () => {
    server.use(
      http.get("*/api/workflows", () => HttpResponse.json([{ name: "alpha%ZZ", steps: [] }])),
    );

    renderShell(<p>x</p>, "/workflows/alpha%ZZ");

    const link = await screen.findByRole("link", { name: /alpha%ZZ/i });
    expect(link.getAttribute("aria-current")).toBe("page");
    await flushAsync();
  });

  it("hides the workflows nav when the registry fetch fails", async () => {
    server.use(http.get("*/api/workflows", () => new HttpResponse("boom", { status: 500 })));

    renderShell(<p>x</p>);

    // Let the rejected fetch (and the rail's other on-mount fetches) settle.
    await flushAsync();
    expect(screen.queryByRole("navigation", { name: /workflows/i })).toBeNull();
    expect(screen.queryByText(/no workflows yet/i)).toBeNull();
  });

  it("refetches the workflows list when a workflow event fires", async () => {
    let calls = 0;
    server.use(
      http.get("*/api/workflows", () => {
        calls++;
        return HttpResponse.json(
          calls === 1 ? [{ name: "alpha", steps: [] }] : [{ name: "beta", steps: [] }],
        );
      }),
    );

    const { sources } = renderShell(<p>x</p>);
    await screen.findByRole("link", { name: /alpha/i });

    act(() => {
      sources[0]?.emit({ type: "workflow.added", name: "beta" });
    });

    await screen.findByRole("link", { name: /beta/i });
    expect(screen.queryByRole("link", { name: /alpha/i })).toBeNull();
    await flushAsync();
  });
});
