import { expect, test } from "@playwright/test";
import { startSession } from "./support/session.ts";

// The stub answers a tidy by upper-casing the draft, so a tidied draft is
// told apart from what was typed without any real rewrite.
test("tidy rewrites the composer draft and undo restores it", async ({ page }) => {
  await startSession(page);
  const composer = page.getByLabel(/message/i);
  await composer.fill("so um i think postgres");

  await page.getByRole("button", { name: "tidy" }).click();
  await expect(composer).toHaveValue("SO UM I THINK POSTGRES");

  await page.getByRole("button", { name: "undo tidy" }).click();
  await expect(composer).toHaveValue("so um i think postgres");
  await expect(page.getByRole("button", { name: "undo tidy" })).toBeHidden();
});
