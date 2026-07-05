import { expect, test } from "@playwright/test";
import { startSession } from "./support/session.ts";

test("pinning a session surfaces it on the feed's Pinned tab", async ({ page }) => {
  const id = await startSession(page);

  // The pin control lives in the right rail; its label flips once the PATCH
  // result lands in the cached detail.
  await page.getByRole("button", { name: /^pin session$/i }).click();
  await expect(page.getByRole("button", { name: /^unpin session$/i })).toBeVisible();

  await page.goto("/");
  await page.getByRole("tab", { name: "Pinned" }).click();
  await expect(page).toHaveURL("/?view=pinned");
  await expect(page.locator(`a[href="/sessions/${id}"]`)).toBeVisible();
});

test("unpinning removes the session from the Pinned tab", async ({ page }) => {
  const id = await startSession(page);

  await page.getByRole("button", { name: /^pin session$/i }).click();
  await expect(page.getByRole("button", { name: /^unpin session$/i })).toBeVisible();

  await page.goto("/?view=pinned");
  await expect(page.locator(`a[href="/sessions/${id}"]`)).toBeVisible();

  await page.goto(`/sessions/${id}`);
  await page.getByRole("button", { name: /^unpin session$/i }).click();
  await expect(page.getByRole("button", { name: /^pin session$/i })).toBeVisible();

  // Sessions pinned by earlier specs may remain in the shared fixture DB, so
  // assert this session's row is gone rather than expecting an empty view.
  await page.goto("/?view=pinned");
  await expect(page.getByText(/loading pinned sessions/i)).toHaveCount(0);
  await expect(page.locator(`a[href="/sessions/${id}"]`)).toHaveCount(0);
});
