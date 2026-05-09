import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../tests/setup/msw.ts";
import { fetchRun, fetchRuns, fetchWorkflows, triggerRun } from "./api.ts";

describe("api client", () => {
  it("returns the workflow registry from the default handler", async () => {
    expect(await fetchWorkflows()).toEqual([]);
  });

  it("returns the run feed from the default handler", async () => {
    expect(await fetchRuns()).toEqual([]);
  });

  it("fetches a single run with its steps", async () => {
    server.use(
      http.get("*/api/runs/:id", ({ params }) =>
        HttpResponse.json({ run: { id: params.id }, steps: [] }),
      ),
    );

    const detail = await fetchRun("abc");

    expect(detail.run.id).toBe("abc");
    expect(detail.steps).toEqual([]);
  });

  it("triggers a manual run and returns the terminal status", async () => {
    const result = await triggerRun("kiri-self-review");

    expect(result.runId).toBe("run-kiri-self-review");
    expect(result.status).toBe("ok");
  });

  it("falls back to status text when the error body is not JSON", async () => {
    server.use(http.get("*/api/runs/:id", () => new HttpResponse("not json", { status: 503 })));

    await expect(fetchRun("missing")).rejects.toThrow(/503/);
  });
});
