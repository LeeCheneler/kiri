import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

const triggerRunWithInputs = async (
  request: APIRequestContext,
  name: string,
  inputs: Record<string, string>,
) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e", "Content-Type": "application/json" },
    data: JSON.stringify({ inputs }),
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("clicking 'run again' re-executes a terminal run under the same id and url", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "slow");
  await page.goto(`/runs/${runId}`);

  // First attempt completes — header flips to ok.
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
  const url = page.url();

  // The rerun handler shows a confirm prompt; accept it once.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /run again/i }).click();

  // SSE drives the row back through running → ok without a reload. The
  // 2s sleep in `slow.yaml` keeps the running window observable.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Same id, same url — the in-place semantics. No navigation.
  expect(page.url()).toBe(url);
});

// Skipped: the home page is a blank Activity shell with no run feed; restore
// when the feed is rebuilt.
test.skip("rerunning does not create a duplicate row on the home feed", async ({
  page,
  request,
}) => {
  // Use `slow` so the running window is observable; with `quick` the
  // ok → running → ok cycle completes inside one event loop tick and
  // SSE coalesces away the running state before Playwright can see it.
  const { runId } = await triggerRun(request, "slow");

  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /run again/i }).click();
  // Wait for the rerun to settle so the home assertion isn't racing
  // mid-flight state.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Back on the feed, the run id has exactly one row — the rerun updated
  // the existing row in place rather than spawning a sibling.
  await page.getByRole("link", { name: /^activity$/i }).click();
  await expect(page).toHaveURL("/");
  const rows = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(rows).toHaveCount(1);
  await expect(rows).toHaveAttribute("data-status", "ok");
});

test("re-running a workflow with inputs opens a pre-filled modal and forwards tweaks", async ({
  page,
  request,
}) => {
  // First attempt with one set of values.
  const { runId } = await triggerRunWithInputs(request, "with-inputs", {
    pr_number: "42",
    branch: "release",
  });
  await page.goto(`/runs/${runId}`);
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
  const url = page.url();

  // Click "run again" — the modal opens pre-filled from the prior snapshot.
  await page.getByRole("button", { name: /run again/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/pr_number/i)).toHaveValue("42");
  await expect(dialog.getByLabel(/branch/i)).toHaveValue("release");
  // Warning text matches the bare path's confirm copy.
  await expect(dialog.getByRole("note")).toContainText(
    "The previous attempt's steps and traces will be cleared.",
  );

  // Tweak just the pr_number and submit.
  await dialog.getByLabel(/pr_number/i).fill("99");
  await dialog.getByRole("button", { name: /^run/i }).click();

  // Same run id and url — in-place rerun. Modal closes once accepted.
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });
  expect(page.url()).toBe(url);

  // The step echoes the resolved env — confirm the tweaked value flowed through.
  const step = page.getByRole("button", { name: /sh:/i });
  await step.click();
  await expect(page.getByText("pr=99 branch=release", { exact: true })).toBeVisible();
});

test("'run again' is hidden while a run is still in flight", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "slow");
  await page.goto(`/runs/${runId}`);

  // Cancel and rerun are mutually exclusive with each other and with the
  // rerun button — during running, only cancel is exposed.
  await expect(page.locator('[data-status="running"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: /cancel run/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /run again/i })).not.toBeVisible();
});
