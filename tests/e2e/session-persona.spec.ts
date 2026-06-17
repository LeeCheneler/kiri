import { expect, test } from "@playwright/test";
import { sendMessage, startSession, usePersona } from "./support/session.ts";

test("attaching a persona from the aside persists across a reload", async ({ page }) => {
  await startSession(page);

  // The fixture defines personas, so the picker is present and starts detached.
  const persona = page.getByLabel(/persona/i);
  await expect(persona).toHaveValue("None");

  await usePersona(page, "pirate");
  await expect(persona).toHaveValue("pirate");

  // The attachment lives on the session row, so it survives a reload.
  await page.reload();
  await expect(page.getByLabel(/persona/i)).toHaveValue("pirate");
});

test("a turn runs with a persona attached", async ({ page }) => {
  await startSession(page);
  await usePersona(page, "pirate");

  // The turn completes against the echo model with the persona composed into the
  // system prompt — attaching a persona doesn't break the turn path.
  await sendMessage(page, "ahoy");
  await expect(page.getByText("You said: ahoy")).toBeVisible({ timeout: 10_000 });
});
