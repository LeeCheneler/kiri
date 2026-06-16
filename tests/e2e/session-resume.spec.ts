import { expect, test } from "@playwright/test";

// `slow` keeps the turn streaming for a few seconds, long enough to reload
// mid-flight before it settles.
const startSlowSession = async (page: import("@playwright/test").Page) => {
  await page.goto("/sessions");
  await page.getByLabel(/model/i).selectOption("fake:slow");
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
};

test("a turn keeps running server-side across a reload and is picked back up", async ({ page }) => {
  await startSlowSession(page);

  const composer = page.getByLabel(/message/i);
  await composer.fill("remember me while I reload");
  await composer.press("Enter");

  // The turn is in flight; reloading drops the client's stream. A dropped
  // connection does not cancel — the server drains and persists the turn.
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await page.reload();

  // The user message survived (it was persisted before streaming) and the
  // assistant reply lands once the server-side turn finishes and the live
  // refetch folds it into the reloaded transcript.
  await expect(page.getByText("remember me while I reload", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: remember me while I reload")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel(/message/i)).toBeEnabled();
});
