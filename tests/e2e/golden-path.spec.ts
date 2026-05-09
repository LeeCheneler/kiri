import { expect, test } from "@playwright/test";

test("client shell mounts and renders the kiri heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /kiri/i })).toBeVisible();
});
