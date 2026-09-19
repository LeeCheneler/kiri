import { describe, expect, it } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../../../tests/setup/msw.ts";
import { ApiError, type SessionInboxResult } from "../../api.ts";
import { isRefusal, queueFailureText, submitQueuedMessage } from "./queue-submission.ts";

const queuedResult: SessionInboxResult = {
  item: { id: "q1", source: "user", text: "hello", fromSessionId: null, createdAt: "2026-09-19" },
  delivered: false,
};

describe("isRefusal", () => {
  it("counts only a client-error response as a refusal", () => {
    expect(isRefusal(new ApiError("gone", 404))).toBe(true);
    expect(isRefusal(new ApiError("boom", 500))).toBe(false);
    expect(isRefusal(new TypeError("fetch failed"))).toBe(false);
  });
});

describe("queueFailureText", () => {
  it("gives the server's reason for a refusal, and says so when the outcome is unknown", () => {
    expect(queueFailureText(new ApiError('session "s1" not found', 404))).toBe(
      'session "s1" not found',
    );
    expect(queueFailureText(new TypeError("fetch failed"))).toContain("Couldn't confirm");
  });
});

describe("submitQueuedMessage", () => {
  it("repeats a submission under the same id until its outcome arrives", async () => {
    const seen: unknown[] = [];
    server.use(
      http.post("*/api/sessions/:id/inbox", async ({ request }) => {
        seen.push(await request.json());
        if (seen.length === 1) return HttpResponse.error();
        if (seen.length === 2) return HttpResponse.json({ error: "boom" }, { status: 500 });
        return HttpResponse.json(queuedResult, { status: 200 });
      }),
    );

    expect(await submitQueuedMessage("s1", "q1", "hello", [0, 0])).toEqual(queuedResult);
    expect(seen).toEqual([
      { id: "q1", text: "hello" },
      { id: "q1", text: "hello" },
      { id: "q1", text: "hello" },
    ]);
  });

  it("stops at a refusal rather than repeating it", async () => {
    let attempts = 0;
    server.use(
      http.post("*/api/sessions/:id/inbox", () => {
        attempts += 1;
        return HttpResponse.json({ error: 'session "s1" not found' }, { status: 404 });
      }),
    );

    await expect(submitQueuedMessage("s1", "q1", "hello", [0, 0])).rejects.toThrow(
      'session "s1" not found',
    );
    expect(attempts).toBe(1);
  });

  it("rejects with the last failure once the repeats run out", async () => {
    let attempts = 0;
    server.use(
      http.post("*/api/sessions/:id/inbox", () => {
        attempts += 1;
        return HttpResponse.json({ error: "boom" }, { status: 500 });
      }),
    );

    await expect(submitQueuedMessage("s1", "q1", "hello", [0, 0])).rejects.toThrow("boom");
    expect(attempts).toBe(3);
  });
});
