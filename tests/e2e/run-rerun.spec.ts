import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking 'run again' re-executes a terminal run under the same id and url", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "slow");
  await page.goto(`/runs/${runId}`);

  // First attempt completes — header flips to ok and the in-flight slot
  // disappears.
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
  const url = page.url();

  // The rerun handler shows a confirm prompt; accept it once.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /run again/i }).click();

  // SSE drives the row back through running → ok without a reload. The
  // 2s sleep in `slow.yaml` keeps the running window observable.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/in flight/i)).toBeVisible();
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Same id, same url — the in-place semantics. No navigation.
  expect(page.url()).toBe(url);
});

test("rerunning does not create a duplicate row on the dashboard feed", async ({
  page,
  request,
}) => {
  // Use `slow` so the running window is observable; with `quick` the
  // ok → running → ok cycle completes inside one event loop tick and
  // SSE coalesces away the running state before Playwright can see it.
  const { runId } = await triggerRun(request, "slow");

  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /run again/i }).click();
  // Wait for the rerun to settle so the dashboard assertion isn't racing
  // mid-flight state.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Back on the feed, the run id has exactly one row — the rerun updated
  // the existing row in place rather than spawning a sibling.
  await page.getByRole("link", { name: /all activity/i }).click();
  await expect(page).toHaveURL("/");
  const rows = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("data-status", "ok");
});

test("'run again' is hidden while a run is still in flight", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "slow");
  await page.goto(`/runs/${runId}`);

  // Cancel and rerun are mutually exclusive with each other and with the
  // rerun button — during running, only cancel is exposed.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: /cancel run/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /run again/i })).not.toBeVisible();
});
