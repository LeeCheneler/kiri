import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// Direct the stub's `tool` model: `call:<name> {<json>}` makes it stream that
// tool call; the args JSON is what the AI SDK validates against the tool's
// schema, so this drives the real create/edit path end to end.
const directive = (name: string, args: Record<string, string>): string =>
  `call:${name} ${JSON.stringify(args)}`;

test("a session writes an article and edits it in place", async ({ page }) => {
  await startSession(page);
  await useModel(page, "fake:tool");

  await sendMessage(
    page,
    directive("create_article", {
      slug: "e2e-notes",
      content_md: "# E2E Notes\n\nOriginal body.",
    }),
  );

  // The article tools are un-gated: the call runs without an approval prompt
  // and the turn settles on the stub's follow-up reply.
  await expect(page.getByText("All done.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^allow$/i })).toHaveCount(0);

  // The rail's Articles panel picked the new article up live; read it.
  const articleLink = page.getByRole("complementary").getByRole("link", { name: "E2E Notes" });
  await expect(articleLink).toBeVisible();
  await articleLink.click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+\/articles\/e2e-notes$/);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Notes" })).toBeVisible();
  await expect(page.getByText("Original body.")).toBeVisible();

  // Back in the session, a targeted edit — exact old string, its replacement.
  await page.goBack();
  await sendMessage(
    page,
    directive("edit_article", {
      slug: "e2e-notes",
      old_string: "Original body.",
      new_string: "Edited body.",
    }),
  );
  await expect(page.getByText("All done.")).toHaveCount(2, { timeout: 10_000 });

  // Returning to the article serves the edited body — the write staled the
  // cached page even while it was unmounted.
  await page.getByRole("complementary").getByRole("link", { name: "E2E Notes" }).click();
  await expect(page.getByText("Edited body.")).toBeVisible();
  await expect(page.getByText("Original body.")).toHaveCount(0);
});
