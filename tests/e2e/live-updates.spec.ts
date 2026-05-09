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

  // Header status starts at running and the duration slot reads "in flight"
  // until the run terminates.
  const headerKicker = page.locator('[data-status="running"]').first();
  await expect(headerKicker).toBeVisible();
  await expect(page.getByText(/in flight/i)).toBeVisible();

  // Without reloading, SSE drives the page to terminal status. The kicker's
  // data-status flips to "ok" and the in-flight indicator disappears.
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/in flight/i)).not.toBeVisible();
});

test("dashboard reflects a new run appearing and reaching terminal status without reload", async ({
  page,
  request,
}) => {
  // Start on the dashboard so the activity feed is mounted before the run is
  // triggered. The new row arrival and the running → ok transition both have
  // to come over the SSE stream — there is no reload in this test.
  await page.goto("/");
  const feed = page.getByRole("main");
  const initialRowCount = await feed.getByRole("link", { name: /slow/i }).count();

  const triggerRes = await request.post("/api/workflows/slow/runs", {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(triggerRes.status()).toBe(202);

  // A new "slow" row appears (count grows by one) and eventually carries an
  // ok data-status — both via live invalidations, no goto/reload.
  await expect
    .poll(() => feed.getByRole("link", { name: /slow/i }).count())
    .toBe(initialRowCount + 1);
  const row = feed.getByRole("link", { name: /slow/i }).first();
  await expect(row).toHaveAttribute("data-status", "ok", { timeout: 10_000 });
});
