import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { NewSessionShortcut } from "./new-session-shortcut.tsx";

const models = (...ids: string[]) => ({
  models: ids.map((id) => ({ id, provider: id.split(":")[0], output: "text" })),
  failures: [],
});

const session = (id: string, model: string) => ({
  id,
  status: "idle",
  model,
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
});

const emptySessionsPage = () => ({ sessions: [], nextCursor: null });

const renderShortcut = () => {
  const memory = memoryLocation({ path: "/", record: true });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <NewSessionShortcut />
        <p>page content</p>
      </Router>
    </QueryClientProvider>,
  );
  return { history: memory.history };
};

// A create handler that counts its calls and answers with a fresh session id.
const countingCreate = () => {
  const calls: string[] = [];
  server.use(
    http.get("*/api/models", () => HttpResponse.json(models("openai:gpt"))),
    http.get("*/api/sessions", () => HttpResponse.json(emptySessionsPage())),
    http.post("*/api/sessions", async ({ request }) => {
      const { model } = (await request.json()) as { model: string };
      calls.push(model);
      return HttpResponse.json({ session: session(`new-${calls.length}`, model) }, { status: 201 });
    }),
  );
  return calls;
};

// The shortcut arms only once the models have loaded — wait for that, or a
// keypress lands before there's a listener and the test proves nothing.
const armed = async () => {
  await waitFor(() => expect(screen.getByText("page content")).toBeDefined());
  // No observable hook for "loaded" besides the effect having run; a resolved
  // models query is one macrotask away, so yield once.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("<NewSessionShortcut>", () => {
  it("starts a session and navigates on the keyboard shortcut, either modifier", async () => {
    const calls = countingCreate();
    const user = userEvent.setup();
    const { history } = renderShortcut();
    await armed();

    await user.keyboard("{Meta>}n{/Meta}");
    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-1"));
    expect(calls).toEqual(["openai:gpt"]);

    await user.keyboard("{Control>}n{/Control}");
    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-2"));
    expect(calls).toEqual(["openai:gpt", "openai:gpt"]);
  });

  it("accepts the Option/Alt-modified form the browser lets through", async () => {
    const calls = countingCreate();
    const user = userEvent.setup();
    const { history } = renderShortcut();
    await armed();

    await user.keyboard("{Meta>}{Alt>}n{/Alt}{/Meta}");
    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-1"));
    expect(calls).toEqual(["openai:gpt"]);
  });

  it("ignores the shifted form and the bare key", async () => {
    const calls = countingCreate();
    const user = userEvent.setup();
    const { history } = renderShortcut();
    await armed();

    await user.keyboard("{Meta>}{Shift>}n{/Shift}{/Meta}");
    await user.keyboard("n");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([]);
    expect(history[history.length - 1]).toBe("/");
  });

  it("does nothing when no models are configured", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models())),
      http.get("*/api/sessions", () => HttpResponse.json(emptySessionsPage())),
      http.post("*/api/sessions", () => {
        throw new Error("must not create");
      }),
    );
    const user = userEvent.setup();
    const { history } = renderShortcut();
    await armed();

    await user.keyboard("{Meta>}n{/Meta}");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(history[history.length - 1]).toBe("/");
  });
});
