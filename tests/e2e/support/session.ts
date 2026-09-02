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
 * Open the composer's models popover, putting the session's model pickers on
 * screen. A no-op when it is already open.
 */
export const openModels = async (page: Page): Promise<void> => {
  const trigger = page.getByRole("button", { name: "models" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
};

/**
 * Point the open session at `model` via the composer's models popover, waiting
 * for the change to persist so the next turn runs against it. The one-click
 * create lands on a default model that carries across the run, so this is a
 * no-op when the session already uses `model` — re-selecting an unchanged value
 * fires no request to await. Drives the searchable combobox: open it, type to
 * filter, pick the match — then closes the popover so the composer is clear
 * for the message that follows.
 */
export const useModel = async (page: Page, model: string): Promise<void> => {
  // The picker groups models by provider and labels each with the bare model
  // name — the group heading carries the provider — so drive it by the name
  // after the `provider:` prefix while `model` stays the full id.
  const bareName = model.slice(model.indexOf(":") + 1);
  await openModels(page);
  // Role-scoped and anchored: the popover panel itself is labelled "Models",
  // and /model/i alone would also match the sibling "Image model" picker.
  const combobox = page.getByRole("combobox", { name: /^model/i });
  if ((await combobox.inputValue()) !== bareName) {
    const persisted = page.waitForResponse(
      (res) => res.request().method() === "PATCH" && res.url().includes("/api/sessions/"),
    );
    await combobox.click();
    await combobox.fill(bareName);
    await page.getByRole("option", { name: bareName, exact: true }).click();
    await persisted;
  }
  await page.keyboard.press("Escape");
};

/** Type `text` into the chat composer and submit the turn. */
export const sendMessage = async (page: Page, text: string): Promise<void> => {
  const composer = page.getByLabel(/message/i);
  await composer.fill(text);
  await composer.press("Enter");
};
