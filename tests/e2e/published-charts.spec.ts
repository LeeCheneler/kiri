import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("a chart code block renders a real chart in a published article", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "charts");

  // Wait for the run to reach its terminal state so the Published
  // section is populated before we follow the article link.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Published articles render in the run's right rail; follow the chart report.
  const articleLink = page.getByRole("link", { name: /chart report/i });
  await articleLink.click();
  await expect(page).toHaveURL(`/runs/${runId}/published/chart-report`);

  // The valid spec compiles and renders a real Vega SVG inside the
  // chart figure.
  await expect(page.locator("article figure svg")).toBeVisible({ timeout: 10_000 });

  // The second block reaches for remote data; Vega's locked-down loader
  // rejects it and the chart degrades to an inline notice rather than
  // breaking the article.
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/remote data/i);

  // Prose after the charts still renders — the article is intact.
  await expect(page.getByText("End of report.")).toBeVisible();
});
