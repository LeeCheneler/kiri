import { expect, test } from "@playwright/test";

// Start a session from the index: pick a model (defaults to the stub's `echo`)
// and land on its chat page. Returns the session id parsed from the URL.
const startSession = async (page: import("@playwright/test").Page, model?: string) => {
  await page.goto("/sessions");
  if (model) await page.getByLabel(/model/i).selectOption(model);
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
};

const send = async (page: import("@playwright/test").Page, text: string) => {
  const composer = page.getByLabel(/message/i);
  await composer.fill(text);
  await composer.press("Enter");
};

test("starting a session, sending a message, and streaming the reply", async ({ page }) => {
  await startSession(page);

  // The composer lands focused on an empty transcript.
  await expect(page.getByText(/no messages yet/i)).toBeVisible();

  await send(page, "hello from kiri e2e");

  // The user message echoes into the transcript immediately; the assistant
  // reply streams back from the stub (which echoes what the user said).
  await expect(page.getByText("hello from kiri e2e", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: hello from kiri e2e")).toBeVisible({ timeout: 10_000 });

  // The composer re-enables once the turn settles, ready for the next message.
  await expect(page.getByLabel(/message/i)).toBeEnabled();

  // Back on the index, the session leads with its first message as the label.
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: /^sessions$/i })
    .click();
  await expect(page).toHaveURL("/sessions");
  await expect(page.getByRole("link", { name: /hello from kiri e2e/i })).toBeVisible();
});

test("a settled turn reports token usage and context fill in the rail", async ({ page }) => {
  await startSession(page);
  await send(page, "count my tokens");
  await expect(page.getByText("You said: count my tokens")).toBeVisible({ timeout: 10_000 });

  // The right rail carries the session marginalia; scope to it so the figures
  // are unambiguous.
  const rail = page.getByRole("complementary").filter({ hasText: "Tokens" });
  await expect(rail.getByText("fake:echo")).toBeVisible();
  // The stub reports a fixed usage of 12 in / 8 out / 20 total per turn.
  await expect(rail.getByText("12", { exact: true })).toBeVisible();
  await expect(rail.getByText("8", { exact: true })).toBeVisible();
  await expect(rail.getByText("20", { exact: true })).toBeVisible();
  // Context fill is the last settled turn's footprint (in + out).
  await expect(rail.getByText(/20 tokens/i)).toBeVisible();
});
