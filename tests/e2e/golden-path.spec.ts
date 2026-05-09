import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { runId: string; status: "ok" | "failed" };
};

test("dashboard renders the wordmark, activity heading, and empty feed", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /kiri/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /activity/i })).toBeVisible();
  await expect(page.getByText(/no runs yet/i)).toBeVisible();
});

test("refreshing on /runs/:id boots the SPA and shows the not-found view", async ({ page }) => {
  await page.goto("/runs/missing-run-id");
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
  await expect(page.getByText("missing-run-id")).toBeVisible();

  await page.getByRole("link", { name: /all activity/i }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText(/no runs yet/i)).toBeVisible();
});

test("a successful run surfaces in the feed with status and link to detail", async ({
  page,
  request,
}) => {
  const { runId, status } = await triggerRun(request, "golden");
  expect(status).toBe("ok");

  await page.goto("/");
  // Scope to <main> so the side nav's "golden" link in the rail doesn't
  // collide with the feed row.
  const row = page.getByRole("main").getByRole("link", { name: /golden/i });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("href", `/runs/${runId}`);
  await expect(row).toHaveAttribute("data-status", "ok");
});

test("a failing run row carries the failed status treatment", async ({ page, request }) => {
  const { status } = await triggerRun(request, "failing");
  expect(status).toBe("failed");

  await page.goto("/");
  const row = page.getByRole("main").getByRole("link", { name: /failing/i });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "failed");
});

test("clicking the wordmark from the run-not-found view returns to the dashboard", async ({
  page,
}) => {
  await page.goto("/runs/missing-run-id");
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
  await page.getByRole("link", { name: "kiri", exact: true }).click();
  await expect(page).toHaveURL("/");
});

test("opening a run detail page reveals stdout when the step is expanded", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "golden");

  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole("heading", { level: 2, name: /golden/i })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: /steps/i })).toBeVisible();

  const step = page.getByRole("button", { name: /sh:/i });
  await expect(step).toHaveAttribute("aria-expanded", "false");
  await step.click();
  await expect(step).toHaveAttribute("aria-expanded", "true");
  // The fixture's `echo` produces this exact stdout; exact: true disambiguates
  // from the kind label and the materials snapshot, both of which contain the
  // same phrase wrapped in `sh: echo "..."`.
  await expect(page.getByText("kiri e2e fixture", { exact: true })).toBeVisible();
});

test("a failed run surfaces a run-level failure block on the detail page", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "failing");

  await page.goto(`/runs/${runId}`);
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/run failed/i);
});

test("triggering a workflow from the side nav lands on the run detail", async ({ page }) => {
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: /workflows/i });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: /golden/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /failing/i })).toBeVisible();

  await nav.getByRole("link", { name: /golden/i }).click();
  await expect(page).toHaveURL("/workflows/golden");
  await expect(page.getByRole("heading", { level: 2, name: /golden/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /golden/i })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: /^run/i }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByRole("heading", { level: 2, name: /golden/i })).toBeVisible();
});
