import { type APIRequestContext, expect, test } from "@playwright/test";

const triggerRun = async (request: APIRequestContext, name: string) => {
  const res = await request.post(`/api/workflows/${name}/runs`, {
    headers: { "X-Kiri-Client": "kiri-e2e" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()) as { runId: string };
};

test("an llm step runs a real completion and shows the model's output on the run detail", async ({
  page,
  request,
}) => {
  const { runId } = await triggerRun(request, "llm");

  await page.goto(`/runs/${runId}`);
  // The completion comes back from the OpenAI-compatible stub, so the run
  // reaches its terminal ok state via the same path as any other step.
  await expect(page.locator('[data-status="ok"]').first()).toBeVisible({ timeout: 10_000 });

  // Expand the step (labelled by its `name:`) to reveal the model's output —
  // the stub echoes the rendered prompt back.
  const step = page.getByRole("button", { name: /ask the model/i });
  await step.click();
  await expect(page.getByText("You said: Say hello", { exact: true })).toBeVisible();
});
