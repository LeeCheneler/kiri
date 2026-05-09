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

  await page.getByRole("link", { name: /back to dashboard/i }).click();
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
  const row = page.getByRole("link", { name: /golden/i });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("href", `/runs/${runId}`);
  await expect(row).toHaveAttribute("data-status", "ok");
});

test("a failing run row carries the failed status treatment", async ({ page, request }) => {
  const { status } = await triggerRun(request, "failing");
  expect(status).toBe("failed");

  await page.goto("/");
  const row = page.getByRole("link", { name: /failing/i });
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
