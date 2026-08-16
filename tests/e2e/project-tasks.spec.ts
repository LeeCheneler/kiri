import { expect, test } from "@playwright/test";
import { createProject, openTasksTab } from "./support/projects.ts";
import { sendMessage, useModel } from "./support/session.ts";

test("a project's task list: groups, tasks, ticking off, editing, hiding, deleting", async ({
  page,
}) => {
  const id = await createProject(page, "E2E Tasks");
  await openTasksTab(page);
  await expect(page.getByText(/no tasks yet/)).toBeVisible();

  // A group, created behind the new-group dialog.
  await page.getByRole("button", { name: "+ New group" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Now");
  await dialog.getByRole("button", { name: /^create$/i }).click();
  const now = page.getByRole("region", { name: "Now" });
  await expect(now).toBeVisible();
  await expect(now.getByText("no tasks")).toBeVisible();

  // A task with a note, from the group's add action.
  await now.getByRole("button", { name: "add task" }).click();
  dialog = page.getByRole("dialog", { name: "Add task" });
  await dialog.getByLabel("Title").fill("Write the docs");
  await dialog.getByLabel("Note").fill("blocked on review");
  await dialog.getByRole("button", { name: "add task" }).click();
  await expect(dialog).not.toBeVisible();
  const checkbox = now.getByRole("checkbox", { name: "Write the docs" });
  await expect(checkbox).toBeVisible();
  await expect(now.getByText("blocked on review")).toBeVisible();
  await expect(now.getByText("1 open")).toBeVisible();

  // The index card counts the open task.
  await page.goto("/projects");
  await expect(page.getByText("1 open task")).toBeVisible();
  await page.goto(`/projects/${id}`);
  await openTasksTab(page);

  // Tick it off — the group reads as all done and the card drops the fact.
  await now.getByRole("checkbox", { name: "Write the docs" }).check();
  await expect(now.getByText("all done")).toBeVisible();

  // Edit the title through the modal.
  await now.getByRole("button", { name: "edit" }).click();
  dialog = page.getByRole("dialog", { name: "Edit task" });
  await dialog.getByLabel("Title").fill("Write all the docs");
  await dialog.getByRole("button", { name: "save" }).click();
  await expect(now.getByRole("checkbox", { name: "Write all the docs" })).toBeVisible();

  // Hide the group; it moves behind the toggle and comes back on unhide.
  await now.getByRole("button", { name: "hide group" }).click();
  await expect(page.getByRole("region", { name: "Now" })).toHaveCount(0);
  await page.getByRole("button", { name: "show 1 hidden group" }).click();
  await expect(page.getByRole("region", { name: "Now" })).toBeVisible();
  await page
    .getByRole("region", { name: "Now" })
    .getByRole("button", { name: "unhide group" })
    .click();
  await expect(page.getByRole("button", { name: /hidden group/ })).toHaveCount(0);

  // Delete the group behind its confirm; the list is empty again.
  await page
    .getByRole("region", { name: "Now" })
    .getByRole("button", { name: "delete group" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();
  await expect(page.getByText(/no tasks yet/)).toBeVisible();
});

test("a session in the project files a task that appears on the page live", async ({ page }) => {
  const id = await createProject(page, "E2E Task Session");

  // Start a session inside the project from its page.
  await page.getByRole("button", { name: /new session/i }).click();
  await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]+$/);
  await useModel(page, "fake:tool");
  await sendMessage(
    page,
    `call:add_task ${JSON.stringify({ group: "From chat", title: "Follow up on the review" })}`,
  );
  // add_task is un-gated: it runs without a prompt and the turn settles.
  await expect(page.getByText("All done.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^allow$/i })).toHaveCount(0);

  await page.goto(`/projects/${id}`);
  await openTasksTab(page);
  const group = page.getByRole("region", { name: "From chat" });
  await expect(group.getByRole("checkbox", { name: "Follow up on the review" })).toBeVisible();
  await expect(group.getByText("1 open")).toBeVisible();
});
