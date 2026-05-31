import { type APIRequestContext, expect, test } from "@playwright/test";

const PAGE_SIZE = 25;
// Seed comfortably past one page so a second page always exists, regardless of
// the runs other specs and parallel workers leave in the shared fixture DB.
const SEED_COUNT = PAGE_SIZE + 10;

const seedRuns = async (request: APIRequestContext, count: number) => {
  // Fire the triggers concurrently; each insert returns 202 and the row is
  // queryable straight away, with execution finishing in the background.
  await Promise.all(
    Array.from({ length: count }, () =>
      request.post("/api/workflows/quick/runs", {
        headers: { "X-Kiri-Client": "kiri-e2e" },
      }),
    ),
  );

  // Wait for the rows to land before navigating, otherwise the home feed races
  // the inserts and renders a thinner first page.
  await expect
    .poll(async () => {
      const res = await request.get("/api/runs?limit=100");
      const body = (await res.json()) as { runs: unknown[] };
      return body.runs.length;
    })
    .toBeGreaterThanOrEqual(count);
};

test("scrolling the activity feed loads past the first page", async ({ page, request }) => {
  await seedRuns(request, SEED_COUNT);

  await page.goto("/");
  // One run-detail link per row; exclude the per-run published-article links
  // under the same path prefix so the count is exactly the rows on screen.
  const rows = page.getByRole("main").locator('a[href^="/runs/"]:not([href*="/published/"])');

  // The feed caps the first page even though more runs exist in the DB.
  await expect(rows).toHaveCount(PAGE_SIZE);

  // Scrolling the foot sentinel into view loads the next page and the row count
  // climbs past one page. Re-scroll on each poll so the observer re-fires if the
  // first nudge landed before the sentinel mounted.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      return rows.count();
    })
    .toBeGreaterThan(PAGE_SIZE);
});
