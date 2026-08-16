import { type Page, expect } from "@playwright/test";

/**
 * Create a project named `name` from the Projects index's create modal and
 * land on its page. Returns the new project's id (parsed from the URL).
 */
export const createProject = async (page: Page, name: string): Promise<string> => {
  await page.goto("/projects");
  await page.getByRole("button", { name: /new project/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
};

/** Open the project page's Tasks tab. */
export const openTasksTab = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Tasks" }).click();
};
