import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("search finds an article from the home search box and opens it", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "articles");

  // Wait for the run to finish so the article exists and is indexed.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  await page.goto("/");
  await page.getByRole("button", { name: /search articles/i }).click();

  const dialog = page.getByRole("dialog");
  const box = dialog.getByRole("textbox", { name: "Search" });
  await expect(box).toBeFocused();

  // A body phrase, not the title — proving content is indexed, and the
  // matched terms come back highlighted. Other specs (and retries) run the
  // articles workflow against the same fixture server, so several identical
  // articles can exist — any Daily Digest hit proves the path.
  await box.fill("first body paragraph");
  const hit = dialog.getByRole("link", { name: /daily digest/i }).first();
  await expect(hit).toBeVisible();
  await expect(dialog.locator("mark").first()).toBeVisible();

  await hit.click();
  await expect(page).toHaveURL(/\/runs\/[^/]+\/articles\/digest$/);
});

test("the keyboard shortcut opens search on any page and Escape closes it", async ({ page }) => {
  await page.goto("/workflows");
  // The shortcut listener attaches when React mounts — wait for the page
  // to be interactive so the keypress can't race hydration.
  await expect(page.getByPlaceholder("Filter workflows…")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");

  const dialog = page.getByRole("dialog");
  const box = dialog.getByRole("textbox", { name: "Search" });
  await expect(box).toBeFocused();

  // Workflow definitions surface as results too.
  await box.fill("charts");
  await expect(dialog.getByRole("link", { name: "charts", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
