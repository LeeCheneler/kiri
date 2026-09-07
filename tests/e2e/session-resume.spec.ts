import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

// `slow` keeps the turn streaming for a few seconds, long enough to reload
// mid-flight before it settles.
const startSlowSession = async (page: import("@playwright/test").Page) => {
  await startSession(page);
  await useModel(page, "fake:slow");
};

test("a turn keeps running server-side across a reload and is picked back up", async ({ page }) => {
  await startSlowSession(page);

  await sendMessage(page, "remember me while I reload");

  // The turn is in flight; reloading drops the client's stream. A dropped
  // connection does not cancel — the server drains and persists the turn.
  await expect(page.locator('[data-status="working"]')).toBeVisible({ timeout: 10_000 });
  await page.reload();

  // The user message survived (it was persisted before streaming) and the
  // assistant reply lands once the server-side turn finishes and the live
  // refetch folds it into the reloaded transcript.
  await expect(page.getByText("remember me while I reload", { exact: true })).toBeVisible();
  await expect(page.getByText("You said: remember me while I reload")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel(/message/i)).toBeEnabled();
});

test("reloading after a completed tool step replays the turn without duplicate messages", async ({
  page,
}) => {
  const sessionId = await startSession(page);
  await useModel(page, "fake:tool-slow");
  const directive = `call:create_article ${JSON.stringify({
    slug: "checkpoint-notes",
    content_md: "# Checkpoint Notes\n\nSaved before the reply.",
  })}`;
  await sendMessage(page, directive);
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Checkpoint Notes" }),
  ).toBeVisible();
  await page.reload();

  await expect(page.getByText("All done.", { exact: true })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByText(directive, { exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/message/i)).toBeEnabled();
  await page.reload();
  await expect(page.getByText("All done.", { exact: true })).toHaveCount(1);
  const detail = await (await page.request.get(`/api/sessions/${sessionId}`)).json();
  expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  const calls = detail.messages[1].parts.filter(
    (p: { type: string }) => p.type === "tool-create_article",
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].state).toBe("output-available");
});
