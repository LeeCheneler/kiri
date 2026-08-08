import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { NewSessionButton } from "./new-session-button.tsx";

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

const sessionsPage = (...entries: ReturnType<typeof session>[]) => ({
  sessions: entries.map((s) => ({ ...s, preview: null })),
  nextCursor: null,
});

const renderButton = (props: { projectId?: string } = {}) => {
  const memory = memoryLocation({ path: "/", record: true });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Router hook={memory.hook}>
        <NewSessionButton {...props} />
      </Router>
    </QueryClientProvider>,
  );
  return { history: memory.history };
};

const enabledButton = async () => {
  const button = await screen.findByRole("button", { name: /new session/i });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  return button;
};

describe("<NewSessionButton>", () => {
  it("starts a session against the most recent session's model and navigates", async () => {
    let sentModel: string | undefined;
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("openai:gpt"))),
      http.get("*/api/sessions", () =>
        HttpResponse.json(sessionsPage(session("s1", "anthropic:claude"))),
      ),
      http.post("*/api/sessions", async ({ request }) => {
        sentModel = ((await request.json()) as { model: string }).model;
        return HttpResponse.json({ session: session("new-1", sentModel) }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { history } = renderButton();

    const button = await enabledButton();
    await user.click(button);

    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-1"));
    expect(sentModel).toBe("anthropic:claude");
    // The button lives in the persistent left nav, so it survives the
    // navigation — it must not stay stuck on "Starting…".
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  });

  it("falls back to the first available model when there are no sessions", async () => {
    let sentModel: string | undefined;
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("openai:gpt", "anthropic:claude"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
      http.post("*/api/sessions", async ({ request }) => {
        sentModel = ((await request.json()) as { model: string }).model;
        return HttpResponse.json({ session: session("new-2", sentModel) }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(await enabledButton());

    await waitFor(() => expect(sentModel).toBe("openai:gpt"));
  });

  it("skips non-text models when falling back to the first model", async () => {
    let sentModel: string | undefined;
    server.use(
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "openrouter:gemini-image", provider: "openrouter", output: "image" },
            { id: "openai:gpt", provider: "openai", output: "text" },
          ],
          failures: [],
        }),
      ),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
      http.post("*/api/sessions", async ({ request }) => {
        sentModel = ((await request.json()) as { model: string }).model;
        return HttpResponse.json({ session: session("new-3", sentModel) }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(await enabledButton());

    await waitFor(() => expect(sentModel).toBe("openai:gpt"));
  });

  it("starts on the first shortcuts, not the most recent model, when shortcuts are configured", async () => {
    let sent: { model?: string; imageModel?: string } = {};
    server.use(
      http.get("*/api/models", () =>
        HttpResponse.json({
          ...models("openai:gpt"),
          shortcuts: {
            text: { flash: "a:small", pro: "a:mid" },
            image: { images: "b:small", fancy: "b:big" },
          },
        }),
      ),
      http.get("*/api/sessions", () =>
        HttpResponse.json(sessionsPage(session("s1", "anthropic:claude"))),
      ),
      http.post("*/api/sessions", async ({ request }) => {
        sent = (await request.json()) as { model: string; imageModel?: string };
        return HttpResponse.json({ session: session("new-4", sent.model ?? "") }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(await enabledButton());

    await waitFor(() => expect(sent).toEqual({ model: "a:small", imageModel: "b:small" }));
  });

  it("starts with no image model when only text shortcuts are configured", async () => {
    let sent: { model?: string; imageModel?: string } = {};
    server.use(
      http.get("*/api/models", () =>
        HttpResponse.json({
          ...models("openai:gpt"),
          shortcuts: { text: { flash: "a:small", pro: "a:mid" } },
        }),
      ),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
      http.post("*/api/sessions", async ({ request }) => {
        sent = (await request.json()) as { model: string; imageModel?: string };
        return HttpResponse.json({ session: session("new-5", sent.model ?? "") }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(await enabledButton());

    await waitFor(() => expect(sent).toEqual({ model: "a:small" }));
  });

  it("creates the session inside the given project", async () => {
    let sentBody: Record<string, unknown> | undefined;
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("openai:gpt"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
      http.post("*/api/sessions", async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ session: session("new-1", "openai:gpt") }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { history } = renderButton({ projectId: "p1" });

    await user.click(await enabledButton());

    await waitFor(() => expect(history[history.length - 1]).toBe("/sessions/new-1"));
    expect(sentBody).toEqual({ model: "openai:gpt", projectId: "p1" });
  });

  it("re-enables and stays put when the create fails", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models("openai:gpt"))),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
      http.post("*/api/sessions", () => new HttpResponse("boom", { status: 500 })),
    );
    const user = userEvent.setup();
    const { history } = renderButton();

    const button = await enabledButton();
    await user.click(button);

    // The failed create re-enables the action for a retry, with no navigation.
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(history[history.length - 1]).toBe("/");
  });

  it("is disabled when no models are configured", async () => {
    server.use(
      http.get("*/api/models", () => HttpResponse.json(models())),
      http.get("*/api/sessions", () => HttpResponse.json(sessionsPage())),
    );
    renderButton();

    const button = await screen.findByRole("button", { name: /new session/i });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
