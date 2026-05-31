import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("recommendation with declared inputs opens the modal pre-filled and flips the row on submit", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "recommends");
  await page.goto(`/runs/${runId}`);

  // Run finishes; the Recommended section materialises with both rows. The
  // section is labelled by an eyebrow, not a heading.
  await expect(page.locator('header [data-status="ok"]').first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Recommended")).toBeVisible();

  const reviewRow = page.getByRole("listitem").filter({ hasText: "Review PR #42" });
  await expect(reviewRow).toBeVisible();
  await expect(reviewRow.getByText("+500/-200, refactor auth")).toBeVisible();

  // Trigger the rec — the standard invoke modal opens pre-filled with the
  // emitted inputs.
  await reviewRow.getByRole("button", { name: /^run →$/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/pr_number/i)).toHaveValue("42");
  await expect(dialog.getByLabel(/branch/i)).toHaveValue("main");

  await dialog.getByRole("button", { name: /^run →$/ }).click();
  await expect(dialog).not.toBeVisible();

  // The row's trigger button is replaced with a link to the spawned run.
  const actionedLink = reviewRow.getByRole("link", { name: /review pr #42/i });
  await expect(actionedLink).toBeVisible({ timeout: 10_000 });
  await expect(actionedLink).toHaveAttribute("href", /^\/runs\//);

  // The spawned run reaches its terminal status; the rec row's status
  // badge tracks it live (without a page reload).
  await expect(reviewRow.locator('[data-status="ok"]')).toBeVisible({ timeout: 10_000 });
});

test("recommendation for a no-input workflow actions immediately without opening a modal", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "recommends");
  await page.goto(`/runs/${runId}`);

  await expect(page.locator('header [data-status="ok"]').first()).toBeVisible({
    timeout: 10_000,
  });

  const quickRow = page.getByRole("listitem").filter({ hasText: "Just a quick one" });
  await expect(quickRow).toBeVisible();

  await quickRow.getByRole("button", { name: /^run →$/ }).click();
  // No modal for a target with no declared inputs — the action fires directly.
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await expect(quickRow.getByRole("link", { name: /just a quick one/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(quickRow.locator('[data-status="ok"]')).toBeVisible({ timeout: 10_000 });
});
