import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { MemoryDetail } from "./memory-detail.tsx";

const NOW = new Date("2026-08-07T12:00:00.000Z");

const detail = (over: Record<string, unknown> = {}) => ({
  name: "prefers-bun",
  description: "Prefers bun over node.",
  contentMd: "Always reach for bun.",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
  ...over,
});

const serveMemory = (memory: unknown) =>
  server.use(http.get("*/api/memories/:name", () => HttpResponse.json({ memory })));

const renderDetail = () => {
  const memory = memoryLocation({ path: "/memories/prefers-bun", record: true });
  render(
    <Router hook={memory.hook}>
      <QueryClientProvider client={createQueryClient()}>
        <MemoryDetail name="prefers-bun" now={NOW} />
      </QueryClientProvider>
    </Router>,
  );
  return { history: memory.history };
};

describe("<MemoryDetail>", () => {
  it("renders the summary and markdown body", async () => {
    serveMemory(detail());
    renderDetail();

    expect(await screen.findByText("Prefers bun over node.")).toBeDefined();
    expect(screen.getByText("Always reach for bun.")).toBeDefined();
  });

  it("renders not-found for a memory that no longer exists", async () => {
    server.use(
      http.get("*/api/memories/:name", () =>
        HttpResponse.json({ error: 'memory "prefers-bun" not found' }, { status: 404 }),
      ),
    );
    renderDetail();

    expect(await screen.findByText("Memory not found")).toBeDefined();
  });

  it("surfaces a non-404 load failure as an alert", async () => {
    server.use(http.get("*/api/memories/:name", () => new HttpResponse("boom", { status: 500 })));
    renderDetail();

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.queryByText("Memory not found")).toBeNull();
  });

  it("surfaces a failed save inline and stays in the editor", async () => {
    serveMemory(detail());
    server.use(http.patch("*/api/memories/:name", () => new HttpResponse("boom", { status: 500 })));
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "edit memory" }));

    await userEvent.click(screen.getByRole("button", { name: "save" }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByLabelText("Summary")).toBeDefined();
  });

  it("edits in place: prefills, patches, and returns to reading", async () => {
    let patched: unknown = null;
    serveMemory(detail());
    server.use(
      http.patch("*/api/memories/:name", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ memory: detail({ description: "New summary." }) });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "edit memory" }));

    const summaryField = screen.getByLabelText("Summary");
    expect((summaryField as HTMLInputElement).value).toBe("Prefers bun over node.");
    await userEvent.clear(summaryField);
    await userEvent.type(summaryField, "New summary.");
    await userEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(patched).toEqual({ description: "New summary.", contentMd: "Always reach for bun." }),
    );
    // Back in reading mode: the editor fields are gone.
    await waitFor(() => expect(screen.queryByLabelText("Summary")).toBeNull());
  });

  it("cancelling an edit keeps the stored content", async () => {
    serveMemory(detail());
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "edit memory" }));

    await userEvent.click(screen.getByRole("button", { name: "cancel" }));

    expect(screen.queryByLabelText("Summary")).toBeNull();
    expect(screen.getByText("Always reach for bun.")).toBeDefined();
  });

  it("deletes behind a confirm and returns to the index", async () => {
    let deleted = false;
    serveMemory(detail());
    server.use(
      http.delete("*/api/memories/:name", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete memory" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/memories"));
    expect(deleted).toBe(true);
  });

  it("dismissing the delete confirm leaves the memory alone", async () => {
    let deleted = false;
    serveMemory(detail());
    server.use(
      http.delete("*/api/memories/:name", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete memory" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleted).toBe(false);
  });

  it("surfaces a failed delete inline and stays on the page", async () => {
    serveMemory(detail());
    server.use(
      http.delete("*/api/memories/:name", () => new HttpResponse("boom", { status: 500 })),
    );
    const { history } = renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "delete memory" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByRole("alert")).toBeDefined();
    expect(history[history.length - 1]).toBe("/memories/prefers-bun");
  });
});
