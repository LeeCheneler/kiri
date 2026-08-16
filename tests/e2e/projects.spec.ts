import { expect, test } from "@playwright/test";
import { createProject } from "./support/projects.ts";

test("creating a project lands on its page, renames, and lists on the index", async ({ page }) => {
  const id = await createProject(page, "E2E Research");
  await expect(page.getByRole("heading", { name: "E2E Research" })).toBeVisible();

  // Rename through the modal; the heading and breadcrumb follow.
  await page.getByRole("button", { name: "rename project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("E2E Renamed");
  await dialog.getByRole("button", { name: "save" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E Renamed" })).toBeVisible();

  // The index carries the container with its (empty) counts.
  await page.goto("/projects");
  const link = page.getByRole("link", { name: "E2E Renamed" });
  await expect(link).toHaveAttribute("href", `/projects/${id}`);
  await expect(page.getByText("0 articles")).toBeVisible();
});

test("deleting a project confirms, then returns to the index without it", async ({ page }) => {
  await createProject(page, "E2E Doomed");

  await page.getByRole("button", { name: "delete project" }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: /^cancel$/i }).click();
  await expect(confirm).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E Doomed" })).toBeVisible();

  await page.getByRole("button", { name: "delete project" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();
  await expect(page).toHaveURL("/projects");
  await expect(page.getByRole("link", { name: "E2E Doomed" })).toHaveCount(0);
});
