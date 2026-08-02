import { type Page, expect } from "@playwright/test";

/**
 * Start a fresh session from the rail's one-click "+ New session" action and
 * land on its chat page. Returns the new session's id (parsed from the URL).
 */
export const startSession = async (page: Page): Promise<string> => {
  await page.goto("/");
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
};

/**
 * Point the open session at `model` via the chat aside, waiting for the change
 * to persist so the next turn runs against it. The one-click create lands on a
 * default model that carries across the run, so this is a no-op when the session
 * already uses `model` — re-selecting an unchanged value fires no request to
 * await. Drives the searchable combobox: open it, type to filter, pick the match.
 */
export const useModel = async (page: Page, model: string): Promise<void> => {
  // Anchored: /model/i would also match the sibling "Image model" picker.
  const combobox = page.getByLabel(/^model/i);
  if ((await combobox.inputValue()) === model) return;
  const persisted = page.waitForResponse(
    (res) => res.request().method() === "PATCH" && res.url().includes("/api/sessions/"),
  );
  await combobox.click();
  await combobox.fill(model);
  await page.getByRole("option", { name: model, exact: true }).click();
  await persisted;
};

/** Type `text` into the chat composer and submit the turn. */
export const sendMessage = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByLabel(/message/i);
  await composer.fill(text);
  await composer.press("Enter");
};
