import { type APIRequestContext, expect, test } from "@playwright/test";

const PAGE_SIZE = 25;
// Three full pages plus a partial fourth so the end-of-feed indicator
// has to appear after at least three rounds of "scroll → next page".
// Real pages have 25 each by default; we seed 60 quicks plus whatever
// leaked from earlier specs, which is enough rounds to exercise the
// observer-driven advance and the eventual end-of-feed render.
const QUICK_SEED_COUNT = 60;

const seedQuickRuns = async (request: APIRequestContext, count: number) => {
  // Fire all triggers concurrently; the server inserts each run row
  // synchronously and returns 202. Background execution completes
  // afterwards but the rows are queryable straight away.
  await Promise.all(
    Array.from({ length: count }, () =>
      request.post("/api/workflows/quick/runs", {
        headers: { "X-Kiri-Client": "kiri-e2e" },
      }),
    ),
  );

  // Confirm the rows landed before navigating — otherwise the home feed
  // would race the inserts and render a thinner first page.
  await expect
    .poll(async () => {
      const res = await request.get("/api/runs?limit=100");
      const body = (await res.json()) as { runs: unknown[] };
      return body.runs.length;
    })
    .toBeGreaterThanOrEqual(count);
};

test("infinite scroll advances through pages and shows an end-of-feed indicator", async ({
  page,
  request,
}) => {
  await seedQuickRuns(request, QUICK_SEED_COUNT);

  await page.goto("/");
  const feed = page.getByRole("main");
  const quickRows = feed.getByRole("link", { name: /quick/i });

  // Page one loads on mount — full page-sized slice of the freshest
  // (quick) runs.
  await expect(quickRows).toHaveCount(PAGE_SIZE);

  // Each scroll brings the sentinel into view; the observer fires,
  // useRunFeed loads the next page, the row count climbs.
  const scrollToBottom = () => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await scrollToBottom();
  await expect(quickRows).toHaveCount(2 * PAGE_SIZE);

  await scrollToBottom();
  // Final quick page contains the remaining 10 plus older runs from
  // prior specs that happen to share the alphabetic neighbourhood —
  // we only assert on the quick rows, so the count caps at the seed
  // total once the page beyond the quicks is loaded.
  await expect(quickRows).toHaveCount(QUICK_SEED_COUNT);

  // Keep scrolling until the feed exhausts. nextCursor = null surfaces
  // the end-of-feed indicator; toBeVisible() auto-waits.
  for (let i = 0; i < 5; i++) {
    await scrollToBottom();
    if (await page.getByText(/end of feed/i).isVisible()) break;
  }
  await expect(page.getByText(/end of feed/i)).toBeVisible();
});

test("a fresh run.started event prepends to the top without disturbing loaded pages", async ({
  page,
  request,
}) => {
  // Pre-condition: enough runs in the DB to exercise multi-page state.
  // The previous test seeded 60+ quicks; this test runs against the
  // same fixture so the rows are still there.
  await page.goto("/");
  const feed = page.getByRole("main");
  const quickRows = feed.getByRole("link", { name: /quick/i });
  await expect(quickRows).toHaveCount(PAGE_SIZE);

  // Scroll one more page in so we're not just asserting on page one.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(quickRows).toHaveCount(2 * PAGE_SIZE);

  // Capture the id of the first row before triggering. After the
  // run.started event flows through, a brand new top row should
  // displace it.
  const firstRowHrefBefore = await quickRows.first().getAttribute("href");

  await request.post("/api/workflows/quick/runs", {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });

  // New row count is one higher; the first row's href has changed
  // (i.e. a new id is sitting on top). Both checks together ensure a
  // surgical prepend rather than a list-rewrite.
  await expect(quickRows).toHaveCount(2 * PAGE_SIZE + 1);
  const firstRowHrefAfter = await quickRows.first().getAttribute("href");
  expect(firstRowHrefAfter).not.toBe(firstRowHrefBefore);
});
