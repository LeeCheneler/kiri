import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerCancellable = async (request: APIRequestContext) => {
  const res = await request.post("/api/workflows/cancellable/runs", {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking cancel on the run detail page transitions the run to cancelled live", async ({
  page,
  request,
}) => {
  const { runId } = await triggerCancellable(request);
  await page.goto(`/runs/${runId}`);

  // While running, the header shows the running status and the cancel button.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible();
  const cancelButton = page.getByRole("button", { name: /cancel run/i });
  await expect(cancelButton).toBeVisible();

  await cancelButton.click();

  // The server SIGTERMs the child and publishes run.finished:cancelled. SSE
  // drives the page to terminal status without reload. The button disappears
  // because the status is no longer running.
  await expect(page.locator('[data-status="cancelled"]').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(cancelButton).not.toBeVisible();
});

test("cancelling via the API surfaces the cancelled treatment in the feed live", async ({
  page,
  request,
}) => {
  // Mount the dashboard before triggering so the row arrival + status
  // transitions both have to come over SSE; no goto/reload after cancel.
  await page.goto("/");
  const feed = page.getByRole("main");
  const initialRowCount = await feed.getByRole("link", { name: /cancellable/i }).count();

  const { runId } = await triggerCancellable(request);
  const cancelRes = await request.post(`/api/runs/${runId}/cancel`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(cancelRes.status()).toBe(202);

  await expect
    .poll(() => feed.getByRole("link", { name: /cancellable/i }).count())
    .toBe(initialRowCount + 1);
  const row = feed.getByRole("link", { name: /cancellable/i }).first();
  await expect(row).toHaveAttribute("data-status", "cancelled", { timeout: 10_000 });
});
