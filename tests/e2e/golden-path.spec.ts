import { expect, test } from "@playwright/test";

test("manual run round-trips from workflow list to step output", async ({ page }) => {
  await page.goto("/");

  const goldenRow = page.locator("li", { hasText: "golden" });
  await expect(goldenRow).toBeVisible();

  await goldenRow.getByRole("button", { name: /run/i }).click();

  const runRow = page.locator(".run-list li", { hasText: "golden" }).first();
  await expect(runRow).toBeVisible();
  await expect(runRow.locator(".status-ok")).toBeVisible();

  await runRow.getByRole("button", { name: /golden/i }).click();

  await expect(page.locator(".run-detail")).toContainText("kiri e2e golden path");
});
