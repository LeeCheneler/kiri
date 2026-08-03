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
    effort: "medium",
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    ...overrides,
  },
  messages,
});

const assistantMessage = (contextTokens: number | null) => ({
  id: "m1",
  sessionId: "s1",
  index: 1,
  role: "assistant",
  parts: [{ type: "text", text: "hi" }],
  contextTokens,
  createdAt: "2026-05-09T12:00:00.000Z",
});

const renderAside = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

// The pickers render blank and disabled until the models listing settles, so
// tests asserting or driving the loaded labels anchor on the enabled control.
const loadedCombobox = async (name: RegExp): Promise<HTMLInputElement> => {
  const combobox = (await screen.findByRole("combobox", { name })) as HTMLInputElement;
  await waitFor(() => expect(combobox.disabled).toBe(false));
  return combobox;
};

describe("<SessionAside>", () => {
  it("renders the session's model", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderAside(<SessionAside id="s1" now={new Date("2026-05-09T12:00:30.000Z")} />);

    const combobox = await loadedCombobox(/model/i);
    // The provider group heading names the provider, so the option label —
    // and the closed input — carry the bare model name.
    expect(combobox.value).toBe("claude");
  });

  it("labels nothing while the model listing loads, then resolves the tier name", async () => {
    // Gate the listing so the in-flight window is observable.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail({ model: "a:small" }))),
      http.get("*/api/models", async () => {
        await gate;
        return HttpResponse.json({
          models: [{ id: "a:small", provider: "a", output: "text" }],
          failures: [],
          tiers: { text: { tanto: "a:small", katana: "a:mid", odachi: "a:big" } },
        });
      }),
    );
    renderAside(<SessionAside id="s1" />);

    // While the listing is in flight the closed input must not show the bare
    // committed value — the label that would immediately be replaced.
    const combobox = (await screen.findByRole("combobox", { name: /model/i })) as HTMLInputElement;
    expect(combobox.value).toBe("");
    expect(combobox.disabled).toBe(true);

    release();
    // Once settled, the tier group labels the value — no intermediate label.
    await waitFor(() => expect(combobox.value).toBe("tanto"));
    expect(combobox.disabled).toBe(false);
  });

  it("changes the session's model when another is picked", async () => {
    let patched: { model?: string } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openai:gpt", provider: "openai", output: "text" },
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

    const combobox = await loadedCombobox(/model/i);
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "gpt" }));

    // The label drops the provider prefix; the committed value keeps the full id.
    await waitFor(() => expect(patched.model).toBe("openai:gpt"));
    // The picker reflects the choice from the PATCH response, without a refetch —
    // the mocked GET still returns the old model, so a stale combobox would fail here.
    await waitFor(() => expect(combobox.value).toBe("gpt"));
  });

  it("groups the models by provider, sorted, with bare model-name labels", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ model: "openai:gpt" })),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "openai:gpt", provider: "openai", output: "text" },
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "google:gemini", provider: "google", output: "text" },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await loadedCombobox(/model/i));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "claude",
      "gemini",
      "gpt",
    ]);
    // Each provider heads its own group under its configured name.
    for (const provider of ["anthropic", "google", "openai"]) {
      expect(screen.getByText(provider)).toBeDefined();
    }
  });

  it("pins the configured text tiers ahead of the full model listing", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openai:gpt", provider: "openai", output: "text" },
          ],
          failures: [],
          tiers: {
            text: { tanto: "openai:gpt", katana: "anthropic:claude", odachi: "anthropic:claude" },
          },
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await loadedCombobox(/^model/i));
    // Tier entries carry the tier name alone; the listing follows grouped by
    // provider with bare model-name labels.
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "tanto",
      "katana",
      "odachi",
      "claude",
      "gpt",
    ]);
    // The pinned tiers group is headed "kiri"; the providers head their own.
    for (const heading of ["kiri", "anthropic", "openai"]) {
      expect(screen.getByText(heading)).toBeDefined();
    }
  });

  it("pins the configured image tiers ahead of the image model listing", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ imageModel: "openai:gpt-image" })),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openai:gpt-image", provider: "openai", output: "image" },
          ],
          failures: [],
          tiers: {
            image: {
              tanto: "openai:gpt-image",
              katana: "openai:gpt-image",
              odachi: "openai:gpt-image",
            },
          },
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await loadedCombobox(/image model/i));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "tanto",
      "katana",
      "odachi",
      "None",
      "gpt-image",
    ]);
  });

  it("offers only text-output models in the model picker", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openrouter:google/gemini-image", provider: "openrouter", output: "image" },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await loadedCombobox(/^model/i));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["claude"]);
  });

  it("notes that the selected model accepts image input", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", imageInput: true },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText("Accepts image input")).toBeDefined();
  });

  it("notes that the selected model is text input only", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", imageInput: false },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    expect(await screen.findByText("Text input only")).toBeDefined();
  });

  it("omits the image input note when the listing doesn't say", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("combobox", { name: /^model/i });
    expect(screen.queryByText("Accepts image input")).toBeNull();
    expect(screen.queryByText("Text input only")).toBeNull();
  });

  it("offers image-output models in the image model picker, with None leading", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openrouter:google/gemini-image", provider: "openrouter", output: "image" },
            { id: "openai:gpt-image-1", provider: "openai", output: "image" },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await loadedCombobox(/image model/i));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "None",
      "gpt-image-1",
      "google/gemini-image",
    ]);
  });

  it("hides the image model picker when no provider offers an image model", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("combobox", { name: /^model/i });
    expect(screen.queryByRole("combobox", { name: /image model/i })).toBeNull();
  });

  it("sets the session's image model when one is picked", async () => {
    let patched: { imageModel?: string | null } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "openrouter:google/gemini-image", provider: "openrouter", output: "image" },
          ],
          failures: [],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { imageModel?: string | null };
        return HttpResponse.json(sessionDetail({ imageModel: "openrouter:google/gemini-image" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const combobox = await loadedCombobox(/image model/i);
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "google/gemini-image" }));

    // Bare label, full committed id — same contract as the text picker.
    await waitFor(() => expect(patched.imageModel).toBe("openrouter:google/gemini-image"));
    await waitFor(() => expect(combobox.value).toBe("google/gemini-image"));
  });

  it("turns image generation off when None is picked", async () => {
    let patched: { imageModel?: string | null } = { imageModel: "unset" };
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ imageModel: "openrouter:google/gemini-image" })),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "openrouter:google/gemini-image", provider: "openrouter", output: "image" },
          ],
          failures: [],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { imageModel?: string | null };
        return HttpResponse.json(sessionDetail({ imageModel: null }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    const combobox = await loadedCombobox(/image model/i);
    expect(combobox.value).toBe("google/gemini-image");
    await userEvent.click(combobox);
    await userEvent.click(screen.getByRole("option", { name: "None" }));

    await waitFor(() => expect(patched.imageModel).toBeNull());
    await waitFor(() => expect(combobox.value).toBe("None"));
  });

  it("pins a selected image model that the provider no longer lists", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ imageModel: "openrouter:delisted-image" })),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    const combobox = await loadedCombobox(/image model/i);
    expect(combobox.value).toBe("delisted-image");
  });

  it("offers the effort control only for a reasoning-capable model", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", reasoning: true },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    const group = await screen.findByRole("radiogroup", { name: /effort/i });
    expect(group).toBeDefined();
    // The session's stored level is the selected segment.
    expect((screen.getByRole("radio", { name: "medium" }) as HTMLInputElement).checked).toBe(true);
  });

  it("hides the effort control for a model without reasoning support", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", reasoning: false },
          ],
          failures: [],
        }),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    await screen.findByRole("combobox", { name: /^model/i });
    expect(screen.queryByRole("radiogroup", { name: /effort/i })).toBeNull();
  });

  it("changes the session's effort when a level is picked", async () => {
    let patched: { effort?: string } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text", reasoning: true },
          ],
          failures: [],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { effort?: string };
        return HttpResponse.json(sessionDetail({ effort: "high" }));
      }),
    );
    renderAside(<SessionAside id="s1" />);

    await userEvent.click(await screen.findByRole("radio", { name: "high" }));

    await waitFor(() => expect(patched.effort).toBe("high"));
    // The control reflects the choice from the PATCH response, without a
    // refetch — the mocked GET still returns medium.
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: "high" }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("surfaces a provider whose model listing failed", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
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
        HttpResponse.json(sessionDetail({}, [assistantMessage(1545)])),
      ),
    );
    renderAside(<SessionAside id="s1" />);

    // The last turn's context footprint, formatted.
    expect(await screen.findByText("1,545 tokens")).toBeDefined();
  });

  it("shows context as current / limit when the model's window is known", async () => {
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({}, [assistantMessage(1545)])),
      ),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            {
              id: "anthropic:claude",
              provider: "anthropic",
              contextWindow: 200000,
              output: "text",
            },
          ],
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
});
