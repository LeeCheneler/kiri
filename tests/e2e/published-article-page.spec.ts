import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking a published article navigates to a page rendering its markdown body", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "publishing");

  // Wait for the run to land in its terminal state on the detail page so
  // the Published section is populated by the time we look for the link.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Published articles render in the run's right rail; follow the digest.
  const articleLink = page.getByRole("link", { name: /published digest/i });
  await expect(articleLink).toHaveAttribute("href", `/runs/${runId}/published/digest`);
  await articleLink.click();

  await expect(page).toHaveURL(`/runs/${runId}/published/digest`);
  // Title in Fraunces lands as the level-2 heading on the article page.
  await expect(page.getByRole("heading", { level: 2, name: /published digest/i })).toBeVisible();
  // Body markdown is rendered through <Markdown>, demoted by two so the
  // authored `# Published Digest` lands at <h3> beneath the route's h2.
  await expect(page.getByRole("heading", { level: 3, name: /published digest/i })).toBeVisible();
  await expect(page.locator("article p").first()).toBeVisible();

  // The breadcrumb's run crumb (the short run id) returns to the parent run.
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: runId.slice(0, 8) })
    .click();
  await expect(page).toHaveURL(`/runs/${runId}`);
});
