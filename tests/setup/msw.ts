import { afterAll, afterEach, beforeAll } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Fixed so a component asserting on the git overview's freshness has something
// stable to read.
const SCANNED_AT = "2026-01-01T00:00:00.000Z";

const defaultHandlers = [
  http.get("*/api/workflows", () => HttpResponse.json([])),
  http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })),
  http.get("*/api/activity", () => HttpResponse.json({ entries: [], nextCursor: null })),
  http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [] })),
  http.get("*/api/config/health", () => HttpResponse.json({ checks: [] })),
  http.get("*/api/mcp/servers", () => HttpResponse.json({ servers: [] })),
  http.get("*/api/personas", () => HttpResponse.json({ personas: [] })),
  http.get("*/api/git", () =>
    HttpResponse.json({ roots: [], repos: [], refreshing: false, scannedAt: SCANNED_AT }),
  ),
  http.get("*/api/sessions", () => HttpResponse.json({ sessions: [], nextCursor: null })),
  // `useChat`'s resume polls this on mount; default to "no live turn to rejoin".
  http.get("*/api/sessions/:id/stream", () => new HttpResponse(null, { status: 204 })),
  http.get("*/api/version", () => HttpResponse.json({ version: "dev" })),
  http.post("*/api/workflows/:name/runs", ({ params }) =>
    HttpResponse.json({ runId: `run-${String(params.name)}`, status: "running" }, { status: 202 }),
  ),
  // Default: pretend the GitHub releases endpoint has nothing for us, so
  // <VersionInfo> tests don't hit the network and never see a spurious
  // "update available" nudge unless the test explicitly opts in.
  http.get(
    "https://api.github.com/repos/LeeCheneler/kiri/releases/latest",
    () => new HttpResponse(null, { status: 404 }),
  ),
];

/**
 * MSW node server intercepting fetch in component tests. Override per-test
 * with `server.use(...)`; the `afterEach` reset restores the defaults.
 */
export const server = setupServer(...defaultHandlers);

beforeAll(() =>
  server.listen({
    // Only police kiri's API surface; let server tests issue real loopback
    // fetches against their own ephemeral Hono listeners.
    onUnhandledRequest(request, print) {
      if (new URL(request.url).pathname.startsWith("/api/")) print.error();
    },
  }),
);
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
