import { expect, test } from "@playwright/test";

test("triggering from the workflow page navigates immediately and shows live transitions", async ({
  page,
}) => {
  await page.goto("/workflows/slow");
  await expect(page.getByRole("heading", { level: 2, name: /slow/i })).toBeVisible();

  // The trigger response is 202 the moment the run row exists, so the click
  // should land on /runs/:id before the slow workflow finishes its 2s sleep.
  await page.getByRole("button", { name: /^run/i }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);

  // Header status starts at running until the run terminates.
  const headerKicker = page.locator('[data-status="running"]').first();
  await expect(headerKicker).toBeVisible();

  // Without reloading, SSE drives the page to terminal status: the
  // kicker's data-status flips to "ok".
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
});

// Skipped: the home page is a blank Activity shell with no run feed; restore
// when the feed is rebuilt.
test.skip("home reflects a new run appearing and reaching terminal status without reload", async ({
  page,
  request,
}) => {
  // Start on home so the activity feed is mounted before the run is
  // triggered. The new row arrival and the running → ok transition both have
  // to come over the SSE stream — there is no reload in this test.
  await page.goto("/");

  const triggerRes = await request.post("/api/workflows/slow/runs", {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(triggerRes.status()).toBe(202);
  const { runId } = (await triggerRes.json()) as { runId: string };

  // The new run's row appears and eventually carries an ok data-status — both
  // via live invalidations, no goto/reload. The row is a stacked-link card;
  // data-status lives on the wrapping <div data-status> sibling of the link, so
  // query the row by the run-id href via :has() — one runId per row, so it is
  // immune to any other "slow" runs already in the feed. The row appearing at
  // all is the live prepend; its data-status is the live status transition.
  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute("data-status", "ok", { timeout: 10_000 });
});
