import { expect, test } from "@playwright/test";

const startSession = async (page: import("@playwright/test").Page, model?: string) => {
  await page.goto("/sessions");
  if (model) await page.getByLabel(/model/i).selectOption(model);
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
};

test("deleting a session removes it and returns to the index", async ({ page }) => {
  const id = await startSession(page);

  const composer = page.getByLabel(/message/i);
  await composer.fill("a throwaway message");
  await composer.press("Enter");
  await expect(page.getByText("You said: a throwaway message")).toBeVisible({ timeout: 10_000 });

  // The delete control lives in the right rail and confirms before acting.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /delete session/i }).click();

  // The handler navigates to the index once the delete lands, and the row is gone.
  await expect(page).toHaveURL("/sessions");
  await expect(page.locator(`a[href="/sessions/${id}"]`)).toHaveCount(0);
});

test("dismissing the confirm leaves the session intact", async ({ page }) => {
  const id = await startSession(page);

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /delete session/i }).click();

  // No navigation, still on the same session.
  await expect(page).toHaveURL(`/sessions/${id}`);
});

test("delete is disabled while a turn is in flight", async ({ page }) => {
  await startSession(page, "fake:slow");

  const composer = page.getByLabel(/message/i);
  await composer.fill("hold the line");
  await composer.press("Enter");

  // The server refuses to delete a running session, so the control disables
  // until the turn settles (it must be cancelled first).
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /delete session/i })).toBeDisabled();
});
