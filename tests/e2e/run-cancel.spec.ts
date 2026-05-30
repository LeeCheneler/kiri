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
  // Mount home before triggering so the row arrival + status
  // transitions both have to come over SSE; no goto/reload after cancel.
  await page.goto("/");

  const { runId } = await triggerCancellable(request);
  const cancelRes = await request.post(`/api/runs/${runId}/cancel`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(cancelRes.status()).toBe(202);

  // Stacked-link row: link wraps the workflow name; data-status lives on the
  // wrapping <div data-status>. Locate this run's row by its link href via
  // :has() — one runId per row, so the match is unambiguous and immune to any
  // other cancellable runs already in the feed. The row appearing at all is
  // the live prepend over SSE; its data-status is the live status transition.
  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute("data-status", "cancelled", { timeout: 10_000 });
});
