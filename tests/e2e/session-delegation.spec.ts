import { expect, test } from "@playwright/test";
import { sendMessage, startSession, useModel } from "./support/session.ts";

test("a worker ending without message_parent notifies its parent and survives reload", async ({
  page,
}) => {
  const sessionId = await startSession(page);
  await useModel(page, "fake:tool");
  await sendMessage(
    page,
    `call:delegate ${JSON.stringify({
      title: "Silent worker",
      task: "Worker answer marker.",
      effort: "low",
    })}`,
  );

  // The fake worker only replies in its own session. Runtime settlement must
  // carry that reply into the parent, which then answers from the notice.
  await expect(page.getByText(/^You said: \[Your delegated worker/)).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByText(/^You said: \[Your delegated worker/)).toHaveCount(1);
  const detail = await (await page.request.get(`/api/sessions/${sessionId}`)).json();
  const notices = detail.messages.flatMap(
    (message: { parts: Array<{ type: string; data?: { source: string; text: string } }> }) =>
      message.parts.filter((part) => part.type === "data-inbox" && part.data?.source === "child"),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0].data.text).toContain("worker's turn ended");
  expect(notices[0].data.text).toContain("Worker answer marker.");
  await expect(page.getByLabel(/message/i)).toBeEnabled();
});
