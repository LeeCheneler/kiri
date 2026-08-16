import { type Page, expect } from "@playwright/test";

/**
 * A name unique to this run: the fixture database is shared across specs and
 * retries, so a repeated name would match earlier rows too.
 */
export const uniqueName = (prefix: string): string => `${prefix} ${Date.now().toString(36)}`;

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

/**
 * Start a session inside the open project from the page's own new-session
 * action (the rail carries a projectless one under the same label), landing
 * on its chat page.
 */
export const startProjectSession = async (page: Page): Promise<void> => {
  await page
    .getByRole("main")
    .getByRole("button", { name: /new session/i })
    .click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
};

/** Open the project page's Tasks tab. */
export const openTasksTab = async (page: Page): Promise<void> => {
  await page.getByRole("tab", { name: "Tasks" }).click();
};
