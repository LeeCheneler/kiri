import { expect, test } from "@playwright/test";
import { createProject, uniqueName } from "./support/projects.ts";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("moving a session rehomes its articles and subsequent edits use the project corpus", async ({
  page,
}) => {
  const projectName = uniqueName("Move destination");
  const projectId = await createProject(page, projectName);
  const sessionId = await startSession(page);
  await useModel(page, "fake:tool");
  await sendMessage(
    page,
    `call:create_article ${JSON.stringify({
      slug: "move-notes",
      content_md: "# Move notes\n\nOriginal body.",
    })}`,
  );
  await expect(page.getByText("All done.")).toBeVisible();
  const rail = page.getByRole("complementary");
  const articleLink = rail.getByRole("link", { name: "Move notes" });
  await expect(articleLink).toHaveAttribute("href", `/sessions/${sessionId}/articles/move-notes`);
  await page.getByLabel(/message/i).fill("Keep my draft");

  await page.getByRole("button", { name: "move to project" }).click();
  const dialog = page.getByRole("dialog", { name: "Move session to project" });
  await expect(dialog.getByRole("button", { name: "move", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: /Project/ }).selectOption({ label: projectName });
  await dialog.getByRole("button", { name: "move", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(`/sessions/${sessionId}`);
  await expect(page.getByLabel(/message/i)).toHaveValue("Keep my draft");
  await expect(rail.getByRole("link", { name: projectName })).toBeVisible();
  await expect(articleLink).toHaveAttribute("href", `/projects/${projectId}/articles/move-notes`);

  await sendMessage(
    page,
    `call:edit_article ${JSON.stringify({
      slug: "move-notes",
      old_string: "Original body.",
      new_string: "Edited after moving.",
    })}`,
  );
  await expect(page.getByText("All done.")).toHaveCount(2);
  await page.goto(`/sessions/${sessionId}/articles/move-notes`);
  await expect(page).toHaveURL(`/projects/${projectId}/articles/move-notes`);
  await expect(page.getByText("Edited after moving.")).toBeVisible();
});
