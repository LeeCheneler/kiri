import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking a published artefact navigates to a page rendering its markdown body", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "publishing");

  // Wait for the run to land in its terminal state on the detail page so
  // the Published section is populated by the time we look for the link.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  const publishedHeading = page.getByRole("heading", { level: 3, name: /^published$/i });
  await expect(publishedHeading).toBeVisible();

  const artefactLink = page.getByRole("link", { name: /published digest/i });
  await expect(artefactLink).toHaveAttribute("href", `/runs/${runId}/published/digest`);
  await artefactLink.click();

  await expect(page).toHaveURL(`/runs/${runId}/published/digest`);
  // Title in Fraunces lands as the level-2 heading on the artefact page.
  await expect(page.getByRole("heading", { level: 2, name: /published digest/i })).toBeVisible();
  // Body markdown is rendered through ArtefactMarkdown — a level-1 heading
  // and at least one paragraph element appear in the tree.
  await expect(page.getByRole("heading", { level: 1, name: /published digest/i })).toBeVisible();
  await expect(page.locator("article p").first()).toBeVisible();

  // The back link returns to the parent run page.
  await page
    .getByRole("link", { name: /back to run/i })
    .first()
    .click();
  await expect(page).toHaveURL(`/runs/${runId}`);
});
