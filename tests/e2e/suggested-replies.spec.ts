import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// The stub suggests its fixed replies only when the settled assistant text
// carries the opt-in marker — the echo model reflects the user's message, so
// sending the marker is how a spec asks for chips.
test("a settled turn offers suggested replies and tapping one sends it", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:echo");

  await sendMessage(page, "shall we proceed? [chips]");
  await expect(page.getByText("You said: shall we proceed? [chips]")).toBeVisible({
    timeout: 10_000,
  });

  // Chips appear above the composer once the turn settles.
  const chips = page.getByRole("group", { name: "Suggested replies" });
  await expect(chips.getByRole("button", { name: "Yes, proceed" })).toBeVisible();
  await expect(chips.getByRole("button", { name: "No, hold off" })).toBeVisible();

  // A reload keeps them: the cached answer re-renders without a fresh turn.
  await page.reload();
  await expect(chips.getByRole("button", { name: "Yes, proceed" })).toBeVisible();

  // Tapping one sends its text as an ordinary user message; the reply to that
  // turn carries no marker, so no new chips replace the row.
  await chips.getByRole("button", { name: "Yes, proceed" }).click();
  await expect(page.getByText("You said: Yes, proceed")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("group", { name: "Suggested replies" })).toBeHidden();
});
