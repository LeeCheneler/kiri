import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { SessionAside } from "./session-aside.tsx";

const sessionDetail = (overrides: Record<string, unknown> = {}, messages: unknown[] = []) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  },
  messages,
});

const assistantMessage = (usage: unknown) => ({
  id: "m1",
  sessionId: "s1",
  index: 1,
  role: "assistant",
  parts: [{ type: "text", text: "hi" }],
  usage,
  createdAt: "2026-05-09T12:00:00.000Z",
});

const renderAside = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe("<SessionAside>", () => {
  it("renders the model, token totals, and start time", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ inputTokens: 7, outputTokens: 2, totalTokens: 9 })),
      ),
    );
    renderAside(<SessionAside id="s1" now={new Date("2026-05-09T12:00:30.000Z")} />);

    const combobox = (await screen.findByRole("combobox", { name: /model/i })) as HTMLInputElement;
    expect(combobox.value).toBe("anthropic:claude");
    expect(screen.getByText("7")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.getByText("9")).toBeDefined();
  });

  it("changes the session's model when another is picked", async () => {
    let patched: { model?: string } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic" },
            { id: "openai:gpt", provider: "openai" },
          ],
          failures: [],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { model?: string };
        return HttpResponse.json(sessionDetail({ model: "openai:gpt" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const combobox = await screen.findByRole("combobox", { name: /model/i });
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "openai:gpt" }));

    await waitFor(() => expect(patched.model).toBe("openai:gpt"));
  });

  it("lists the models alphabetically", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ model: "openai:gpt" })),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "openai:gpt", provider: "openai" },
            { id: "anthropic:claude", provider: "anthropic" },
            { id: "google:gemini", provider: "google" },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await screen.findByRole("combobox", { name: /model/i }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "anthropic:claude",
      "google:gemini",
      "openai:gpt",
    ]);
  });

  it("surfaces a provider whose model listing failed", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic" }],
          failures: [{ provider: "openai", reason: "401 Unauthorized" }],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText(/openai models unavailable/i)).toBeDefined();
    expect(screen.getByText("401 Unauthorized")).toBeDefined();
  });

  it("disables the model select while a turn is in flight", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail({ status: "running" }))),
    );
    renderAside(<SessionAside id="s1" />);

    const combobox = (await screen.findByRole("combobox", { name: /model/i })) as HTMLInputElement;
    expect(combobox.disabled).toBe(true);
  });

  it("renders nothing until the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    const { container } = renderAside(<SessionAside id="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the current context size from the last settled turn", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail({}, [
            assistantMessage({ inputTokens: 1200, outputTokens: 345, totalTokens: 1545 }),
          ]),
        ),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    // input + output of the last turn, formatted.
    expect(await screen.findByText("1,545 tokens")).toBeDefined();
  });

  it("shows context as current / limit when the model's window is known", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(
          sessionDetail({}, [
            assistantMessage({ inputTokens: 1200, outputTokens: 345, totalTokens: 1545 }),
          ]),
        ),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", contextWindow: 200000 }],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText("1,545 / 200,000 tokens")).toBeDefined();
  });

  it("omits the context size until a turn has settled", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("combobox", { name: /model/i });
    expect(screen.queryByText("Context")).toBeNull();
  });

  it("hides the persona picker when the workspace defines none", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("combobox", { name: /model/i });
    expect(screen.queryByRole("combobox", { name: /persona/i })).toBeNull();
  });

  it("attaches a persona by id when its humanised label is picked", async () => {
    let patched: { persona?: string | null } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/personas", () =>
        HttpResponse.json({
          personas: [
            { id: "code-reviewer", name: "Code Reviewer" },
            { id: "pirate", name: "Pirate" },
          ],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { persona?: string | null };
        return HttpResponse.json(sessionDetail({ persona: "pirate" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await screen.findByRole("combobox", { name: /persona/i }));
    // The option shows the humanised label; the patch sends the underlying id.
    await userEvent.click(screen.getByRole("option", { name: "Pirate" }));

    await waitFor(() => expect(patched.persona).toBe("pirate"));
  });
});
