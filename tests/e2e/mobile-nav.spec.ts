import { expect, test } from "@playwright/test";

// The rest of the suite runs at the desktop viewport, where the rail is a
// permanent left column. Pin this file below the `lg` breakpoint so the rail's
// small-screen behaviour — the top bar and the navigation drawer — is exercised
// in a real browser.
test.use({ viewport: { width: 390, height: 760 } });

test("collapses the rail to a top bar and opens the nav in a drawer", async ({ page }) => {
  await page.goto("/");

  // The top bar keeps the wordmark and a menu button; the full workflows nav is
  // collapsed away rather than stacked above the feed.
  await expect(page.getByRole("heading", { level: 1, name: /kiri/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /workflows/i })).not.toBeVisible();

  await page.getByRole("button", { name: /menu/i }).click();

  const drawer = page.getByRole("dialog", { name: /navigation/i });
  await expect(drawer).toBeVisible();
  // The drawer hosts the same rail content — Home and the live workflows nav.
  await expect(drawer.getByRole("link", { name: /^home$/i })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /golden/i })).toBeVisible();
});

test("selecting a workflow in the drawer navigates and closes it", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /menu/i }).click();
  const drawer = page.getByRole("dialog", { name: /navigation/i });
  await expect(drawer).toBeVisible();

  await drawer.getByRole("link", { name: /golden/i }).click();

  await expect(page).toHaveURL("/workflows/golden");
  await expect(page.getByRole("heading", { level: 2, name: /golden/i })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("dismisses the drawer with Escape", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /menu/i }).click();
  const drawer = page.getByRole("dialog", { name: /navigation/i });
  await expect(drawer).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  // Closing the native dialog restores focus to the trigger that opened it.
  await expect(page.getByRole("button", { name: /menu/i })).toBeFocused();
});
