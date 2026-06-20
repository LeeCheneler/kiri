import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("editing a user message resends it and drops the later turns", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");

  await sendMessage(page, "first question");
  await expect(page.getByText("You said: first question")).toBeVisible({ timeout: 10_000 });
  // Wait for the turn to settle (the composer re-enables) before editing.
  await expect(page.getByLabel(/^message$/i)).toBeEnabled();

  // Open the inline editor on the user message, rewrite it, and resend.
  await page.getByRole("button", { name: "edit", exact: true }).click();
  const editor = page.getByLabel(/edit message/i);
  await expect(editor).toHaveValue("first question");
  await editor.fill("a sharper question");
  await editor.press("Enter");

  // The conversation re-runs from the edited message: the fresh reply streams in,
  // and the original question and its answer are gone (truncated server-side).
  await expect(page.getByText("You said: a sharper question")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("a sharper question", { exact: true })).toBeVisible();
  await expect(page.getByText("first question", { exact: true })).toHaveCount(0);
  await expect(page.getByText("You said: first question")).toHaveCount(0);
});
