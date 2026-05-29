import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking delete on the run detail page removes the row and navigates home", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "quick");
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /^delete$/i }).click();

  // The handler navigates to "/" once the 204 lands.
  await expect(page).toHaveURL("/");

  // Server-side cascade actually ran — re-visiting the run id now resolves
  // to the not-found view rather than a stale detail page.
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
});

test("dismissing the confirm prompt leaves the run intact", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "quick");
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /^delete$/i }).click();

  // No navigation, no removal — still on the detail page, status still ok.
  await expect(page).toHaveURL(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible();
});

test("deleting via the API removes the row from the home feed live", async ({ page, request }) => {
  // Mount home first so the row arrival and the run.deleted-driven
  // removal both have to come over SSE; no reload after the delete.
  await page.goto("/");
  const feed = page.getByRole("main");

  const { runId } = await triggerRun(request, "quick");

  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveAttribute("data-status", "ok");

  const initialRowCount = await feed.getByRole("link", { name: /quick/i }).count();

  const deleteRes = await request.delete(`/api/runs/${runId}`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(deleteRes.status()).toBe(204);

  // run.deleted on the SSE bus drives the row out of the feed without a reload.
  await expect(row).not.toBeVisible({ timeout: 10_000 });
  await expect
    .poll(() => feed.getByRole("link", { name: /quick/i }).count())
    .toBe(initialRowCount - 1);
});
