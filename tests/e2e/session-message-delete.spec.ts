import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("deleting a user message drops it and the turns after it", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");

  await sendMessage(page, "first question");
  await expect(page.getByText("You said: first question")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/^message$/i)).toBeEnabled();

  await sendMessage(page, "second question");
  await expect(page.getByText("You said: second question")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/^message$/i)).toBeEnabled();

  // Delete the second user message; the in-app confirm names the action.
  await page.getByRole("button", { name: "delete", exact: true }).nth(1).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();

  // The second turn is gone — message and reply — while the first survives.
  await expect(page.getByText("You said: second question")).toHaveCount(0);
  await expect(page.getByText("second question", { exact: true })).toHaveCount(0);
  await expect(page.getByText("You said: first question")).toBeVisible();
  await expect(page.getByText("first question", { exact: true })).toBeVisible();
});

test("cancelling the confirm leaves the transcript intact", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");

  await sendMessage(page, "keep me");
  await expect(page.getByText("You said: keep me")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "delete", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: /^cancel$/i }).click();
  await expect(confirm).not.toBeVisible();

  await expect(page.getByText("keep me", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: keep me")).toBeVisible();
});
