import { expect, test } from "@playwright/test";

// `boom` responds with a provider error, so a turn against it fails.
const startBoomSession = async (page: import("@playwright/test").Page) => {
  await page.goto("/sessions");
  await page.getByLabel(/model/i).selectOption("fake:boom");
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
};

test("a provider error surfaces a failure at the transcript foot, and the session stays usable", async ({
  page,
}) => {
  await startBoomSession(page);

  const composer = page.getByLabel(/message/i);
  await composer.fill("this will fail");
  await composer.press("Enter");

  // The failed turn shows the failed status and the error message, not a reply.
  await expect(page.locator('[data-status="failed"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alert")).toBeVisible();

  // The session is resumable after a failed turn: the composer re-enables for
  // the next message rather than locking the conversation.
  await expect(page.getByLabel(/message/i)).toBeEnabled();
});
