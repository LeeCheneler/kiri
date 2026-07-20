import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("deleting a session removes it and returns to the activity feed", async ({ page }) => {
  const id = await startSession(page);
  await useModel(page, "fake:echo");

  await sendMessage(page, "a throwaway message");
  await expect(page.getByText("You said: a throwaway message")).toBeVisible({ timeout: 10_000 });

  // The delete control lives in the right rail and confirms in-app before
  // acting.
  await page.getByRole("button", { name: /delete session/i }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();

  // The handler returns to the feed's Sessions view once the delete lands, and
  // the row is gone.
  await expect(page).toHaveURL("/?view=sessions");
  await expect(page.locator(`a[href="/sessions/${id}"]`)).toHaveCount(0);
});

test("cancelling the confirm leaves the session intact", async ({ page }) => {
  const id = await startSession(page);

  await page.getByRole("button", { name: /delete session/i }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: /^cancel$/i }).click();
  await expect(confirm).not.toBeVisible();

  // No navigation, still on the same session.
  await expect(page).toHaveURL(`/sessions/${id}`);
});

test("delete is disabled while a turn is in flight", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:slow");

  await sendMessage(page, "hold the line");

  // The server refuses to delete a running session, so the control disables
  // until the turn settles (it must be cancelled first).
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /delete session/i })).toBeDisabled();
});
