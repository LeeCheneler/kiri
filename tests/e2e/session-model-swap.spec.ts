import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("swapping the model mid-chat changes which model the next turn runs against", async ({
  page,
}) => {
  await startSession(page);

  // First turn against the echo model: a normal streamed reply.
  await useModel(page, "fake:echo");
  await sendMessage(page, "before the swap");
  await expect(page.getByText("You said: before the swap")).toBeVisible({ timeout: 10_000 });

  // Swap to the error model mid-conversation. The next turn runs against it and
  // fails — where echo would have replied — proving the swap took effect for the
  // turns that follow it.
  await useModel(page, "fake:boom");
  await expect(page.getByLabel(/^model/i)).toHaveValue("fake:boom");

  await sendMessage(page, "after the swap");
  await expect(page.locator('[data-status="failed"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("alert")).toBeVisible();
});

test("the model select is disabled while a turn is streaming", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:slow");

  await sendMessage(page, "hold while streaming");

  // While the slow turn streams the session is running, so the model can't be
  // swapped out from under the in-flight turn.
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel(/^model/i)).toBeDisabled();
});
