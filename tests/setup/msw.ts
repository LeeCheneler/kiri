import { afterAll, afterEach, beforeAll } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const defaultHandlers = [
  http.get("*/api/workflows", () => HttpResponse.json([])),
  http.get("*/api/runs", () => HttpResponse.json({ runs: [], nextCursor: null })),
  http.get("*/api/articles/recent", () => HttpResponse.json([])),
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
