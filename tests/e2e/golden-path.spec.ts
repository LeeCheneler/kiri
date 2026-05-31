import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  // Run starts in `running` and reaches its terminal status in the background;
  // the page-level assertions below auto-wait for the DB row + SSE-driven view
  // updates to converge. Tests that need to assert post-completion only — like
  // run-detail content checks — should wait via the existing `data-status` and
  // duration-visibility assertions rather than blocking here.
  return (await res.json()) as { runId: string; status: "running" };
};

test("home renders the wordmark and the activity breadcrumb", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /kiri/i })).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
  await expect(breadcrumb.getByText(/activity/i)).toBeVisible();
});

test("refreshing on /runs/:id boots the SPA and shows the not-found view", async ({ page }) => {
  await page.goto("/runs/missing-run-id");
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
  await expect(page.getByText("missing-run-id")).toBeVisible();

  await page.getByRole("link", { name: /^activity$/i }).click();
  await expect(page).toHaveURL("/");
});

test("a successful run surfaces in the feed with status and link to detail", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "golden");

  await page.goto("/");
  // Row uses a stacked-link pattern — the link wraps the workflow name;
  // data-status lives on the wrapping `<div data-status>` above it. Query
  // the row by its link href (unambiguous: one runId per row) and assert
  // both the link target and the wrapper's data-status from it.
  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "ok");
});

test("a failing run row carries the failed status treatment", async ({ page, request }) => {
  const { runId } = await triggerRun(request, "failing");

  await page.goto("/");
  const row = page.locator(`main [data-status]:has(a[href="/runs/${runId}"])`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "failed");
});

test("clicking Home from the run-not-found view returns to home", async ({ page }) => {
  await page.goto("/runs/missing-run-id");
  await expect(page.getByRole("heading", { name: /run not found/i })).toBeVisible();
  // The wordmark is a heading now, not a link — the Home nav row navigates home.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page).toHaveURL("/");
});

test("opening a run detail page reveals stdout when the step is expanded", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "golden");

  await page.goto(`/runs/${runId}`);
  // The workflow name sits in the eyebrow above the run's short-id heading,
  // and the pipeline renders under the "Steps" group label.
  await expect(page.getByText("golden · Run")).toBeVisible();
  await expect(page.getByText("Steps")).toBeVisible();

  const step = page.getByRole("button", { name: /sh:/i });
  await expect(step).toHaveAttribute("aria-expanded", "false");
  await step.click();
  await expect(step).toHaveAttribute("aria-expanded", "true");
  // The fixture's `echo` produces this exact stdout; exact: true
  // disambiguates from the kind label, which contains the same phrase
  // wrapped in `sh: echo "..."`.
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
  // On the run page the workflow name is the eyebrow, not the heading.
  await expect(page.getByText("golden · Run")).toBeVisible();
});

test("invoking a workflow with inputs opens a modal, collects values, and lands on the run", async ({
  page,
}) => {
  await page.goto("/workflows/with-inputs");
  await expect(page.getByRole("heading", { level: 2, name: /with-inputs/i })).toBeVisible();

  // Clicking the workflow's run affordance opens the modal rather than
  // invoking immediately. The dialog is labelled by its heading so the
  // role query is sufficient.
  await page.getByRole("button", { name: /^run/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2, name: /with-inputs/i })).toBeVisible();

  // Default is pre-filled; required field is empty so submit is disabled.
  await expect(dialog.getByLabel(/branch/i)).toHaveValue("main");
  await expect(dialog.getByRole("button", { name: /^run/i })).toBeDisabled();

  // Filling the required field enables submit, which routes to the run.
  await dialog.getByLabel(/pr_number/i).fill("42");
  await expect(dialog.getByRole("button", { name: /^run/i })).toBeEnabled();
  await dialog.getByRole("button", { name: /^run/i }).click();

  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByText("with-inputs · Run")).toBeVisible();

  // The step echoes the resolved env, confirming the inputs flowed through
  // the API → snapshot → spawn env path. The disclosure has to be expanded
  // to reveal stdout; the kind label disambiguates from any future button.
  const step = page.getByRole("button", { name: /sh:/i });
  await step.click();
  await expect(page.getByText("pr=42 branch=main", { exact: true })).toBeVisible();
});
