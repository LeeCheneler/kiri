import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// `boom` responds with a provider error, so a turn against it fails.
const startBoomSession = async (page: import("@playwright/test").Page) => {
  await startSession(page);
  await useModel(page, "fake:boom");
};

test("a provider error surfaces a failure at the transcript foot, and the session stays usable", async ({
  page,
}) => {
  await startBoomSession(page);

  await sendMessage(page, "this will fail");

  // The failed turn shows the failed status and the error message, not a reply.
  await expect(page.locator('[data-status="failed"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alert")).toBeVisible();

  // The session is resumable after a failed turn: the composer re-enables for
  // the next message rather than locking the conversation.
  await expect(page.getByLabel(/message/i)).toBeEnabled();
});
