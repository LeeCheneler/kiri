import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../tests/setup/msw.ts";
import { ApiError, cancelRun, fetchRun, fetchRunsPage, fetchWorkflows, triggerRun } from "./api.ts";

describe("api client", () => {
  it("returns the workflow registry from the default handler", async () => {
    expect(await fetchWorkflows()).toEqual([]);
  });

  it("returns the run feed from the default handler", async () => {
    expect(await fetchRunsPage()).toEqual({ runs: [], nextCursor: null });
  });

  it("forwards cursor and limit as query params", async () => {
    const seen: { cursor: string | null; limit: string | null }[] = [];
    server.use(
      http.get("*/api/runs", ({ request }) => {
        const url = new URL(request.url);
        seen.push({
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
        });
        return HttpResponse.json({ runs: [], nextCursor: null });
      }),
    );

    await fetchRunsPage({ cursor: "abc-123", limit: 10 });

    expect(seen).toEqual([{ cursor: "abc-123", limit: "10" }]);
  });

  it("fetches a single run with its steps and run.artefacts", async () => {
    server.use(
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({
          run: {
            id: params.id,
            artefacts: [{ name: "digest", title: "Digest", createdAt: "2026-05-09T12:00:00.000Z" }],
          },
          steps: [],
        }),
      ),
    );

    const detail = await fetchRun("abc");

    expect(detail.run.id).toBe("abc");
    expect(detail.steps).toEqual([]);
    expect(detail.run.artefacts).toEqual([
      { name: "digest", title: "Digest", createdAt: "2026-05-09T12:00:00.000Z" },
    ]);
  });

  it("triggers a manual run and returns the runId with running status", async () => {
    const result = await triggerRun("kiri-self-review");

    expect(result.runId).toBe("run-kiri-self-review");
    expect(result.status).toBe("running");
  });

  it("falls back to status text when the error body is not JSON", async () => {
    server.use(http.get("*/api/runs/:id", () => new HttpResponse("not json", { status: 503 })));

    await expect(fetchRun("missing")).rejects.toThrow(/503/);
  });

  it("cancels an in-flight run and returns the runId", async () => {
    const seen: { header: string | null }[] = [];
    server.use(
      http.post("*/api/runs/:id/cancel", ({ request, params }) => {
        seen.push({ header: request.headers.get("X-Kiri-Client") });
        return HttpResponse.json({ runId: params.id }, { status: 202 });
      }),
    );

    const result = await cancelRun("abc-123");

    expect(result.runId).toBe("abc-123");
    expect(seen).toHaveLength(1);
    expect(seen[0].header).toBe("kiri-ui");
  });

  it("throws an ApiError carrying the 409 status when the run is already terminal", async () => {
    server.use(
      http.post("*/api/runs/:id/cancel", () =>
        HttpResponse.json({ error: 'run "abc" is not in flight' }, { status: 409 }),
      ),
    );

    try {
      await cancelRun("abc");
      throw new Error("expected cancelRun to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('run "abc" is not in flight');
    }
  });

  it("throws an ApiError carrying the HTTP status on non-2xx responses", async () => {
    server.use(
      http.get("*/api/runs/:id", () =>
        HttpResponse.json({ error: 'run "missing" not found' }, { status: 404 }),
      ),
    );

    try {
      await fetchRun("missing");
      throw new Error("expected fetchRun to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe('run "missing" not found');
    }
  });
});
