import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("a mermaid code block renders a real diagram in an article", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "diagrams");

  // Wait for the run to reach its terminal state so the Articles
  // section is populated before we follow the article link.
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Articles render in the run's right rail; follow the diagram report.
  const articleLink = page.getByRole("link", { name: /diagram report/i });
  await articleLink.click();
  await expect(page).toHaveURL(`/runs/${runId}/articles/diagram-report`);

  // The valid flowchart parses and renders a real mermaid SVG inside the
  // diagram figure.
  await expect(page.locator("article figure svg")).toBeVisible({ timeout: 10_000 });

  // The malformed block can't parse and degrades to an inline notice rather
  // than breaking the article.
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/could not be rendered/i);

  // The failed parse must not leak mermaid's own "bomb" error graphic, which
  // it otherwise strands on document.body for layout and never cleans up.
  await expect(page.getByText("Syntax error in text")).toHaveCount(0);
  await expect(page.locator('body > [id^="dmermaid"]')).toHaveCount(0);

  // Prose after the diagrams still renders — the article is intact.
  await expect(page.getByText("End of report.")).toBeVisible();
});
