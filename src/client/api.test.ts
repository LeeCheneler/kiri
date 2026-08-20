import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../tests/setup/msw.ts";
import {
  ApiError,
  actionRecommendation,
  cancelRun,
  deleteRun,
  deleteSession,
  fetchRun,
  fetchRunsPage,
  fetchWorkflows,
  queueSessionMessage,
  rerunRun,
  tidyDraft,
  triggerRun,
  truncateSessionMessages,
  withdrawQueuedMessage,
} from "./api.ts";

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

  it("fetches a single run with its steps and run.articles", async () => {
    server.use(
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({
          run: {
            id: params.id,
            articles: [
              {
                slug: "digest",
                name: "Digest",
                heading: "Digest body heading",
                createdAt: "2026-05-09T12:00:00.000Z",
              },
            ],
          },
          steps: [],
        }),
      ),
    );

    const detail = await fetchRun("abc");

    expect(detail.run.id).toBe("abc");
    expect(detail.steps).toEqual([]);
    expect(detail.run.articles).toEqual([
      {
        slug: "digest",
        name: "Digest",
        heading: "Digest body heading",
        createdAt: "2026-05-09T12:00:00.000Z",
      },
    ]);
  });

  it("triggers a manual run and returns the runId with running status", async () => {
    const result = await triggerRun("kiri-self-review");

    expect(result.runId).toBe("run-kiri-self-review");
    expect(result.status).toBe("running");
  });

  it("posts the inputs map as JSON when supplied to triggerRun", async () => {
    const seen: { body: string; contentType: string | null }[] = [];
    server.use(
      http.post("*/api/workflows/:name/runs", async ({ request, params }) => {
        seen.push({
          body: await request.text(),
          contentType: request.headers.get("Content-Type"),
        });
        return HttpResponse.json(
          { runId: `run-${String(params.name)}`, status: "running" },
          { status: 202 },
        );
      }),
    );

    await triggerRun("pr-review", { pr_number: "42", owner: "kiri" });

    expect(seen).toHaveLength(1);
    expect(seen[0].contentType).toBe("application/json");
    expect(JSON.parse(seen[0].body)).toEqual({
      inputs: { pr_number: "42", owner: "kiri" },
    });
  });

  it("omits the body entirely when no inputs are passed", async () => {
    const seen: { body: string }[] = [];
    server.use(
      http.post("*/api/workflows/:name/runs", async ({ request, params }) => {
        seen.push({ body: await request.text() });
        return HttpResponse.json(
          { runId: `run-${String(params.name)}`, status: "running" },
          { status: 202 },
        );
      }),
    );

    await triggerRun("no-inputs-workflow");

    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe("");
  });

  it("falls back to status text when the error body is not JSON", async () => {
    server.use(http.get("*/api/runs/:id", () => new HttpResponse("not json", { status: 503 })));

    try {
      await fetchRun("missing");
      throw new Error("expected fetchRun to throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/503/);
    }
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

  it("deletes a finished run and resolves without a body on 204", async () => {
    const seen: { method: string; header: string | null; id: string }[] = [];
    server.use(
      http.delete("*/api/runs/:id", ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          id: String(params.id),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const result = await deleteRun("abc-123");
    expect(result).toBeUndefined();
    expect(seen).toEqual([{ method: "DELETE", header: "kiri-ui", id: "abc-123" }]);
  });

  it("throws an ApiError carrying 409 when delete races an in-flight run", async () => {
    server.use(
      http.delete("*/api/runs/:id", () =>
        HttpResponse.json({ error: 'run "abc" is in flight; cancel it first' }, { status: 409 }),
      ),
    );

    try {
      await deleteRun("abc");
      throw new Error("expected deleteRun to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('run "abc" is in flight; cancel it first');
    }
  });

  it("throws an ApiError with a status-text fallback when delete fails without JSON", async () => {
    server.use(http.delete("*/api/runs/:id", () => new HttpResponse("nope", { status: 500 })));

    try {
      await deleteRun("abc");
      throw new Error("expected deleteRun to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it("deletes a session and resolves without a body on 204", async () => {
    const seen: { method: string; header: string | null; id: string }[] = [];
    server.use(
      http.delete("*/api/sessions/:id", ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          id: String(params.id),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const result = await deleteSession("s1");
    expect(result).toBeUndefined();
    expect(seen).toEqual([{ method: "DELETE", header: "kiri-ui", id: "s1" }]);
  });

  it("throws an ApiError carrying 409 when delete races an in-flight turn", async () => {
    server.use(
      http.delete("*/api/sessions/:id", () =>
        HttpResponse.json(
          { error: 'session "s1" has a turn in flight; cancel it first' },
          { status: 409 },
        ),
      ),
    );

    try {
      await deleteSession("s1");
      throw new Error("expected deleteSession to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('session "s1" has a turn in flight; cancel it first');
    }
  });

  it("truncates a session's transcript from a message and resolves on 204", async () => {
    const seen: { method: string; header: string | null; id: string; messageId: string }[] = [];
    server.use(
      http.delete("*/api/sessions/:id/messages/:messageId", ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          id: String(params.id),
          messageId: String(params.messageId),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const result = await truncateSessionMessages("s1", "m2");
    expect(result).toBeUndefined();
    expect(seen).toEqual([{ method: "DELETE", header: "kiri-ui", id: "s1", messageId: "m2" }]);
  });

  it("throws an ApiError carrying 409 when truncation races an in-flight turn", async () => {
    server.use(
      http.delete("*/api/sessions/:id/messages/:messageId", () =>
        HttpResponse.json(
          { error: 'session "s1" has a turn in flight; cancel it first' },
          { status: 409 },
        ),
      ),
    );

    try {
      await truncateSessionMessages("s1", "m2");
      throw new Error("expected truncateSessionMessages to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('session "s1" has a turn in flight; cancel it first');
    }
  });

  it("queues a message for an in-flight turn and returns the queued row", async () => {
    const seen: { method: string; header: string | null; id: string; body: unknown }[] = [];
    const item = { id: "q1", source: "user", text: "also check X", createdAt: "2026-08-20" };
    server.use(
      http.post("*/api/sessions/:id/inbox", async ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          id: String(params.id),
          body: await request.json(),
        });
        return HttpResponse.json({ item }, { status: 201 });
      }),
    );

    expect(await queueSessionMessage("s1", "also check X")).toEqual({
      item: { ...item, source: "user" },
    });
    expect(seen).toEqual([
      { method: "POST", header: "kiri-ui", id: "s1", body: { text: "also check X" } },
    ]);
  });

  it("throws an ApiError carrying 409 when the queue races the turn settling", async () => {
    server.use(
      http.post("*/api/sessions/:id/inbox", () =>
        HttpResponse.json(
          { error: 'session "s1" has no turn in flight to queue for' },
          {
            status: 409,
          },
        ),
      ),
    );

    try {
      await queueSessionMessage("s1", "too late");
      throw new Error("expected queueSessionMessage to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
    }
  });

  it("withdraws a still-queued message, resolving true", async () => {
    const seen: { id: string; itemId: string }[] = [];
    server.use(
      http.delete("*/api/sessions/:id/inbox/:itemId", ({ params }) => {
        seen.push({ id: String(params.id), itemId: String(params.itemId) });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    expect(await withdrawQueuedMessage("s1", "q1")).toBe(true);
    expect(seen).toEqual([{ id: "s1", itemId: "q1" }]);
  });

  it("resolves false when the withdrawn message was already delivered", async () => {
    server.use(
      http.delete("*/api/sessions/:id/inbox/:itemId", () =>
        HttpResponse.json({ error: "not queued" }, { status: 404 }),
      ),
    );

    expect(await withdrawQueuedMessage("s1", "q1")).toBe(false);
  });

  it("reruns a terminal run and returns the existing runId with running status", async () => {
    const seen: { method: string; header: string | null; id: string }[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          id: String(params.id),
        });
        return HttpResponse.json({ runId: params.id, status: "running" }, { status: 202 });
      }),
    );

    const result = await rerunRun("abc-123");

    expect(result.runId).toBe("abc-123");
    expect(result.status).toBe("running");
    expect(seen).toEqual([{ method: "POST", header: "kiri-ui", id: "abc-123" }]);
  });

  it("posts the inputs map as JSON when supplied to rerunRun", async () => {
    const seen: { body: string; contentType: string | null }[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", async ({ request, params }) => {
        seen.push({
          body: await request.text(),
          contentType: request.headers.get("Content-Type"),
        });
        return HttpResponse.json({ runId: String(params.id), status: "running" }, { status: 202 });
      }),
    );

    await rerunRun("abc-123", { pr_number: "42", owner: "kiri" });

    expect(seen).toHaveLength(1);
    expect(seen[0].contentType).toBe("application/json");
    expect(JSON.parse(seen[0].body)).toEqual({
      inputs: { pr_number: "42", owner: "kiri" },
    });
  });

  it("omits the body entirely when rerunRun is called without inputs", async () => {
    const seen: { body: string }[] = [];
    server.use(
      http.post("*/api/runs/:id/rerun", async ({ request, params }) => {
        seen.push({ body: await request.text() });
        return HttpResponse.json({ runId: String(params.id), status: "running" }, { status: 202 });
      }),
    );

    await rerunRun("abc-123");

    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe("");
  });

  it("throws an ApiError carrying 409 when rerun races an in-flight run", async () => {
    server.use(
      http.post("*/api/runs/:id/rerun", () =>
        HttpResponse.json({ error: 'run "abc" is in flight; cancel it first' }, { status: 409 }),
      ),
    );

    try {
      await rerunRun("abc");
      throw new Error("expected rerunRun to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('run "abc" is in flight; cancel it first');
    }
  });

  it("posts to the action endpoint with the runId and recId path-encoded and returns the spawned run id", async () => {
    const seen: { method: string; header: string | null; runId: string; recId: string }[] = [];
    server.use(
      http.post("*/api/runs/:runId/recommendations/:recId/action", ({ request, params }) => {
        seen.push({
          method: request.method,
          header: request.headers.get("X-Kiri-Client"),
          runId: String(params.runId),
          recId: String(params.recId),
        });
        return HttpResponse.json({ runId: "spawned-1", status: "running" }, { status: 202 });
      }),
    );

    const result = await actionRecommendation("producer-1", "rec-1");

    expect(result).toEqual({ runId: "spawned-1", status: "running" });
    expect(seen).toEqual([
      { method: "POST", header: "kiri-ui", runId: "producer-1", recId: "rec-1" },
    ]);
  });

  it("posts the user-edited inputs as JSON when supplied to actionRecommendation", async () => {
    const seen: { body: string; contentType: string | null }[] = [];
    server.use(
      http.post("*/api/runs/:runId/recommendations/:recId/action", async ({ request }) => {
        seen.push({
          body: await request.text(),
          contentType: request.headers.get("Content-Type"),
        });
        return HttpResponse.json({ runId: "spawned-2", status: "running" }, { status: 202 });
      }),
    );

    await actionRecommendation("producer-1", "rec-1", { pr_number: "42" });

    expect(seen).toHaveLength(1);
    expect(seen[0].contentType).toBe("application/json");
    expect(JSON.parse(seen[0].body)).toEqual({ inputs: { pr_number: "42" } });
  });

  it("posts the draft to the tidy endpoint and returns the rewritten text", async () => {
    let seen: unknown;
    server.use(
      http.post("*/api/tidy", async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ text: "I think we should use Postgres." });
      }),
    );

    const text = await tidyDraft("so um postgres");

    expect(seen).toEqual({ text: "so um postgres" });
    expect(text).toBe("I think we should use Postgres.");
  });

  it("throws an ApiError carrying 400 when no utility model is configured", async () => {
    server.use(
      http.post("*/api/tidy", () =>
        HttpResponse.json({ error: "no utility model configured" }, { status: 400 }),
      ),
    );

    try {
      await tidyDraft("anything");
      throw new Error("expected tidyDraft to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(400);
      expect((err as ApiError).message).toBe("no utility model configured");
    }
  });

  it("throws an ApiError carrying 409 when the recommendation has already been actioned", async () => {
    server.use(
      http.post("*/api/runs/:runId/recommendations/:recId/action", () =>
        HttpResponse.json(
          { error: 'recommendation "rec-1" has already been actioned' },
          { status: 409 },
        ),
      ),
    );

    try {
      await actionRecommendation("producer-1", "rec-1");
      throw new Error("expected actionRecommendation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).message).toBe('recommendation "rec-1" has already been actioned');
    }
  });
});
