import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// `slow` keeps the turn streaming for a few seconds, long enough to reload
// mid-flight before it settles.
const startSlowSession = async (page: import("@playwright/test").Page) => {
  await startSession(page);
  await useModel(page, "fake:slow");
};

test("a turn keeps running server-side across a reload and is picked back up", async ({ page }) => {
  await startSlowSession(page);

  await sendMessage(page, "remember me while I reload");

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
