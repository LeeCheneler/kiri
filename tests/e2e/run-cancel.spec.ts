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
  // Mount home before triggering so the row arrival + status transitions both
  // have to come over SSE; no goto/reload after cancel.
  await page.goto("/");

  const { runId } = await triggerCancellable(request);

  // Locate this run's row by its link href via :has() — one runId per row, so
  // the match is unambiguous and immune to any other cancellable runs in the
  // feed. data-status lives on the wrapping <div data-status>.
  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);

  // Wait until the run is observably running before cancelling — by then its
  // child process is live, so the SIGTERM reaches it rather than racing the
  // spawn (which would leave the sleep to finish on its own). The row arriving
  // as running is itself the live prepend over SSE.
  await expect(row).toHaveAttribute("data-status", "running", { timeout: 10_000 });

  const cancelRes = await request.post(`/api/runs/${runId}/cancel`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(cancelRes.status()).toBe(202);

  // run.finished:cancelled on the SSE bus drives the row to its cancelled
  // treatment without a reload.
  await expect(row).toHaveAttribute("data-status", "cancelled", { timeout: 10_000 });
});
