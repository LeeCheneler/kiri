import { expect, test } from "@playwright/test";
import { openModels, sendMessage, startSession, useModel } from "./support/session.ts";

test("starting a session, sending a message, and streaming the reply", async ({ page }) => {
  const id = await startSession(page);
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

  // Back on the activity feed's Sessions view, this session's row leads with
  // the title kiri generated off the opening message (the stub answers every
  // title generation with its fixed title, and other specs' sessions share
  // the fixture DB — so scope to the row by href rather than by name).
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: /^sessions$/i })
    .click();
  await expect(page).toHaveURL("/?view=sessions");
  const row = page.locator(`a[href="/sessions/${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(/kiri e2e session/i);
});

test("a settled turn reports the context fill in the rail", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");
  await sendMessage(page, "count my tokens");
  await expect(page.getByText("You said: count my tokens")).toBeVisible({ timeout: 10_000 });

  // The right rail carries the session marginalia; scope to it (anchored on
  // its delete action) so the figure is unambiguous.
  const rail = page.getByRole("complementary").filter({ hasText: "delete session" });
  await openModels(page);
  await expect(page.getByRole("combobox", { name: /^model/i })).toHaveValue("echo");
  await page.keyboard.press("Escape");
  // Context fill is the last settled turn's footprint — the stub reports 20.
  await expect(rail.getByText(/20 tokens/i)).toBeVisible();
});
