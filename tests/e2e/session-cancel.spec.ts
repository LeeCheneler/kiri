import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// `slow` holds the stream open (a lead pause, then word by word) so the
// in-flight state is observable and the cancel lands mid-turn.
const startSlowSession = async (page: import("@playwright/test").Page) => {
  await startSession(page);
  await useModel(page, "fake:slow");
};

test("Escape cancels an in-flight turn and leaves the session usable", async ({ page }) => {
  await startSlowSession(page);

  await sendMessage(page, "take your time");

  // The transcript foot shows the working status while the turn streams; the
  // composer disables for the duration.
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/message/i)).toBeDisabled();

  // Esc aborts the turn (client stop + server cancel). The working cue clears
  // and the composer re-enables — without a failure, since a cancel is not an
  // error.
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-status="working"]')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/message/i)).toBeEnabled();
  await expect(page.getByRole("alert")).not.toBeVisible();
});
