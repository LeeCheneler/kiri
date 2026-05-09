import { expect, test } from "@playwright/test";

test("dashboard route renders the kiri heading and empty run feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /kiri/i })).toBeVisible();
  await expect(page.getByText(/no runs yet/i)).toBeVisible();
});

test("refreshing on /runs/:id boots the SPA and shows the not-found view", async ({ page }) => {
  await page.goto("/runs/missing-run-id");
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
  await expect(page.getByText("missing-run-id")).toBeVisible();

  await page.getByRole("link", { name: /back to dashboard/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/no runs yet/i)).toBeVisible();
});
