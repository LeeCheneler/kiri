import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionsIndex } from "./sessions-index.tsx";

const models = (...ids: string[]) => ({
  models: ids.map((id) => ({ id, provider: id.split(":")[0] })),
  failures: [],
});

const sessionRow = (id: string, model = "anthropic:claude", preview: string | null = null) => ({
  id,
  status: "idle",
  model,
  startedAt: "2026-05-09T12:00:00.000Z",
  finishedAt: null,
  error: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  preview,
});

const sessionsPage = (sessions: unknown[]) => ({ sessions, nextCursor: null });

const stall = () => new Promise<Response>(() => {});

const renderIndex = (now?: Date) => {
  const memory = memoryLocation({ path: "/sessions", record: true });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <SessionsIndex now={now} />
      </Router>
    </QueryClientProvider>,
  );
  return { history: memory.history };
};

describe("<SessionsIndex>", () => {
  it("shows loading states while models and sessions load", () => {
    server.use(http.get("*/api/models", stall), http.get("*/api/sessions", stall));
    renderIndex();
    expect(screen.getByText(/loading models/i)).toBeDefined();
    expect(screen.getByText(/loading sessions/i)).toBeDefined();
  });

  it("shows an error when models fail to load", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage([]))),
    );
    renderIndex();
    expect(await screen.findByText(/failed to load models/i)).toBeDefined();
  });

  it("prompts to configure a provider when no models are available", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models())),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage([]))),
    );
    renderIndex();
    expect(await screen.findByText(/no models available/i)).toBeDefined();
  });

  it("starts a session against the chosen model and navigates to it", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("anthropic:claude", "openai:gpt"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage([]))),
      http.post("*/api/sessions", () =>
        HttpResponse.json({ session: sessionRow("new-1") }, { status: 201 }),
      ),
    );
    const { history } = renderIndex();

    await user.click(await screen.findByRole("button", { name: /new session/i }));

    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-1"));
  });

  it("re-enables the control when starting a session fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("anthropic:claude"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage([]))),
      http.post("*/api/sessions", () => HttpResponse.json({ error: "bad model" }, { status: 400 })),
    );
    const { history } = renderIndex();

    await user.click(await screen.findByRole("button", { name: /new session/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /new session/i })).toBeDefined());
    expect(history[history.length - 1]).toBe("/sessions");
  });

  it("shows an error when the session list fails to load", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("anthropic:claude"))),
      http.get("*/api/sessions", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    renderIndex();
    expect(await screen.findByText(/failed to load sessions/i)).toBeDefined();
  });

  it("shows an empty state when there are no sessions", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("anthropic:claude"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage([]))),
    );
    renderIndex();
    expect(await screen.findByText(/no sessions yet/i)).toBeDefined();
  });

  it("lists sessions as links labelled by their first message, falling back to the id", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("anthropic:claude"))),
      http.get("*/api/sessions", () =>
        HttpResponse.json(
          sessionsPage([
            sessionRow("s1", "anthropic:claude", "Summarise the readme"),
            sessionRow("s2", "openai:gpt"),
          ]),
        ),
      ),
    );
    renderIndex(new Date("2026-05-09T12:00:30.000Z"));

    // The first message is the session's identifier; without one the id stands in.
    const first = await screen.findByRole("link", { name: /summarise the readme/i });
    expect(first.getAttribute("href")).toBe("/sessions/s1");
    expect(screen.getByRole("link", { name: "s2" }).getAttribute("href")).toBe("/sessions/s2");
  });
});
