import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("starting a session, sending a message, and streaming the reply", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");

  // The composer lands focused on an empty transcript.
  await expect(page.getByText(/no messages yet/i)).toBeVisible();

  await sendMessage(page, "hello from kiri e2e");

  // The user message echoes into the transcript immediately; the assistant
  // reply streams back from the stub (which echoes what the user said).
  await expect(page.getByText("hello from kiri e2e", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: hello from kiri e2e")).toBeVisible({ timeout: 10_000 });

  // The composer re-enables once the turn settles, ready for the next message.
  await expect(page.getByLabel(/message/i)).toBeEnabled();

  // Back on the activity feed's Sessions view, the session leads with its first
  // message as the label.
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: /^sessions$/i })
    .click();
  await expect(page).toHaveURL("/?view=sessions");
  await expect(page.getByRole("link", { name: /hello from kiri e2e/i })).toBeVisible();
});

test("a settled turn reports the context fill in the rail", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");
  await sendMessage(page, "count my tokens");
  await expect(page.getByText("You said: count my tokens")).toBeVisible({ timeout: 10_000 });

  // The right rail carries the session marginalia; scope to it (anchored on
  // its pin action) so the figure is unambiguous.
  const rail = page.getByRole("complementary").filter({ hasText: "pin session" });
  await expect(page.getByLabel(/^model/i)).toHaveValue("echo");
  // Context fill is the last settled turn's footprint — the stub reports 20.
  await expect(rail.getByText(/20 tokens/i)).toBeVisible();
});
