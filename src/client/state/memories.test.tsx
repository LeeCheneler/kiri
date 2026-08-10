import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { captureEventSources } from "../../../tests/setup/fake-event-source.ts";
import { flushAsync } from "../../../tests/setup/flush-async.ts";
import { server } from "../../../tests/setup/msw.ts";
import { LiveEventsProvider } from "../events/live.tsx";
import {
  useDeleteMemory,
  useMemories,
  useMemoriesLive,
  useMemory,
  useUpdateMemory,
} from "./memories.ts";
import { createQueryClient } from "./query-client.ts";

const summary = (name: string, description = "A fact.") => ({
  name,
  description,
  updatedAt: "2026-08-07T10:00:00.000Z",
});

const detail = (name: string, contentMd = "# Fact\n\nBody.") => ({
  name,
  description: "A fact.",
  contentMd,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
});

const ListProbe = () => {
  useMemoriesLive();
  const memories = useMemories().data ?? [];
  return <p>memories:{memories.map((m) => m.name).join(",")}</p>;
};

const DetailProbe = ({ name }: { name: string }) => {
  useMemoriesLive();
  const memory = useMemory(name).data;
  return <p>body:{memory?.contentMd ?? "none"}</p>;
};

const MutateProbe = () => {
  const update = useUpdateMemory();
  const remove = useDeleteMemory();
  const memories = useMemories().data ?? [];
  return (
    <div>
      <p>memories:{memories.map((m) => m.name).join(",")}</p>
      <button type="button" onClick={() => void update("prefers-bun", { description: "New." })}>
        update
      </button>
      <button type="button" onClick={() => void remove("prefers-bun")}>
        delete
      </button>
    </div>
  );
};

const renderProbe = (ui: React.ReactNode) => {
  const { factory, sources } = captureEventSources();
  const rendered = render(
    <QueryClientProvider client={createQueryClient()}>
      <LiveEventsProvider factory={factory}>{ui}</LiveEventsProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, sources };
};

describe("memories state", () => {
  it("ignores a project-scoped memory event — it belongs to that project's caches", async () => {
    let fetches = 0;
    server.use(
      http.get("*/api/memories", () => {
        fetches += 1;
        return HttpResponse.json({ memories: [summary("alpha")] });
      }),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("memories:alpha")).toBeDefined();
    expect(fetches).toBe(1);

    act(() => {
      sources[0]?.emit({ type: "memory.saved", name: "deploy-window", projectId: "p1" });
    });
    await flushAsync();
    expect(fetches).toBe(1);
  });

  it("refetches the index when a memory is saved", async () => {
    server.use(
      http.get("*/api/memories", () => HttpResponse.json({ memories: [summary("alpha")] })),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("memories:alpha")).toBeDefined();

    server.use(
      http.get("*/api/memories", () =>
        HttpResponse.json({ memories: [summary("alpha"), summary("prefers-bun")] }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "memory.saved", name: "prefers-bun" });
    });
    expect(await screen.findByText("memories:alpha,prefers-bun")).toBeDefined();
  });

  it("refetches a mounted detail when its memory is saved, and re-syncs on reconnect", async () => {
    server.use(
      http.get("*/api/memories/prefers-bun", () =>
        HttpResponse.json({ memory: detail("prefers-bun", "Old body.") }),
      ),
    );
    const { sources } = renderProbe(<DetailProbe name="prefers-bun" />);
    expect(await screen.findByText("body:Old body.")).toBeDefined();

    server.use(
      http.get("*/api/memories/prefers-bun", () =>
        HttpResponse.json({ memory: detail("prefers-bun", "New body.") }),
      ),
    );
    act(() => {
      sources[0]?.emit({ type: "memory.saved", name: "prefers-bun" });
    });
    expect(await screen.findByText("body:New body.")).toBeDefined();

    server.use(
      http.get("*/api/memories/prefers-bun", () =>
        HttpResponse.json({ memory: detail("prefers-bun", "Reconnected body.") }),
      ),
    );
    // The first open is the initial connect; the second is a reconnect, which
    // must re-sync anything missed while disconnected.
    act(() => sources[0]?.triggerOpen());
    act(() => sources[0]?.triggerOpen());
    expect(await screen.findByText("body:Reconnected body.")).toBeDefined();
  });

  it("drops a deleted memory from a mounted index", async () => {
    server.use(
      http.get("*/api/memories", () =>
        HttpResponse.json({ memories: [summary("alpha"), summary("stale-fact")] }),
      ),
    );
    const { sources } = renderProbe(<ListProbe />);
    expect(await screen.findByText("memories:alpha,stale-fact")).toBeDefined();

    server.use(
      http.get("*/api/memories", () => HttpResponse.json({ memories: [summary("alpha")] })),
    );
    act(() => {
      sources[0]?.emit({ type: "memory.deleted", name: "stale-fact" });
    });
    expect(await screen.findByText("memories:alpha")).toBeDefined();
  });

  it("writes an update then refetches from the server's truth", async () => {
    let patched: unknown = null;
    server.use(
      http.get("*/api/memories", () =>
        HttpResponse.json({ memories: [summary("prefers-bun", patched ? "New." : "Old.")] }),
      ),
      http.patch("*/api/memories/prefers-bun", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ memory: detail("prefers-bun") });
      }),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("memories:prefers-bun")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "update" }));

    expect(patched).toEqual({ description: "New." });
  });

  it("deletes a memory then refetches the index", async () => {
    let deleted = false;
    server.use(
      http.get("*/api/memories", () =>
        HttpResponse.json({ memories: deleted ? [] : [summary("prefers-bun")] }),
      ),
      http.delete("*/api/memories/prefers-bun", () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderProbe(<MutateProbe />);
    expect(await screen.findByText("memories:prefers-bun")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "delete" }));

    expect(await screen.findByText("memories:")).toBeDefined();
    expect(deleted).toBe(true);
  });
});
