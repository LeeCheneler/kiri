import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking an article navigates to a page rendering its markdown body", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "articles");

  // Wait for the run to land in its terminal state on the detail page so
  // the Articles section is populated by the time we look for the link.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Articles render in the run's right rail, labelled by the body's
  // first heading (falling back to the article name); follow the digest.
  const articleLink = page.getByRole("link", { name: /this week in review/i });
  await expect(articleLink).toHaveAttribute("href", `/runs/${runId}/articles/digest`);
  await articleLink.click();

  await expect(page).toHaveURL(`/runs/${runId}/articles/digest`);
  // The body's `# headline` is the level-1 page title; the article name
  // ("Daily Digest") rides in the eyebrow as the series label.
  await expect(page.getByRole("heading", { level: 1, name: /this week in review/i })).toBeVisible();
  // The body's `##` headings are the article's sections, rendered as h2 with
  // the section-NN anchors the table of contents reads.
  await expect(page.getByRole("heading", { level: 2, name: /first section/i })).toBeVisible();
  await expect(page.locator('article h2[id^="section-"]')).toHaveCount(2);
  await expect(page.locator("article p").first()).toBeVisible();

  // The breadcrumb's run crumb — the run named by when it ran — returns to it.
  await page
    .getByRole("navigation", { name: /breadcrumb/i })
    .getByRole("link", { name: /\d\d:\d\d/ })
    .click();
  await expect(page).toHaveURL(`/runs/${runId}`);
});
