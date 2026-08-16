import { expect, test } from "@playwright/test";
import { createProject, uniqueName } from "./support/projects.ts";

// The fixture database is shared across specs and retries, so names are
// unique per run and assertions target this run's rows rather than counts.
test("creating a project lands on its page, renames, and lists on the index", async ({ page }) => {
  const name = uniqueName("E2E Research");
  const renamed = uniqueName("E2E Renamed");
  const id = await createProject(page, name);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Rename through the modal; the heading follows.
  await page.getByRole("button", { name: "rename project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(renamed);
  await dialog.getByRole("button", { name: "save" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

  // The index links to the container under its new name.
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: renamed })).toHaveAttribute(
    "href",
    `/projects/${id}`,
  );
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});

test("deleting a project confirms, then returns to the index without it", async ({ page }) => {
  const name = uniqueName("E2E Doomed");
  await createProject(page, name);

  await page.getByRole("button", { name: "delete project" }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: /^cancel$/i }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("button", { name: "delete project" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});
