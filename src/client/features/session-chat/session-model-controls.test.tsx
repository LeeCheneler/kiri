import { describe, expect, it } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { server } from "../../../../tests/setup/msw.ts";
import { createQueryClient } from "../../state/query-client.ts";
import { type MicrophoneState, SessionModelControls } from "./session-model-controls.tsx";

const sessionDetail = (overrides: Record<string, unknown> = {}) => ({
  session: {
    id: "s1",
    status: "idle",
    model: "anthropic:claude",
    effort: "medium",
    title: null,
    startedAt: "2026-05-09T12:00:00.000Z",
    finishedAt: null,
    error: null,
    ...overrides,
  },
  messages: [],
});

const renderControls = (ui: ReactNode) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

// The controls live behind the toolbar's "settings" trigger; every interaction
// starts by opening its popover.
const openSettings = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "settings" }));
};

// The pickers render blank and disabled until the models listing settles, so
// tests asserting or driving the loaded labels anchor on the enabled control.
const loadedPicker = async (name: RegExp): Promise<HTMLInputElement> => {
  const combobox = (await screen.findByRole("combobox", { name })) as HTMLInputElement;
  await waitFor(() => expect(combobox.disabled).toBe(false));
  return combobox;
};

describe("<SessionModelControls>", () => {
  it("keeps the model group behind the settings trigger until opened", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderControls(<SessionModelControls id="s1" />);

    await screen.findByRole("button", { name: "settings" });
    expect(screen.queryByRole("combobox", { name: /^model/i })).toBeNull();

    await openSettings();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeDefined();
    expect(screen.getByRole("combobox", { name: /^model/i })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: /effort/i })).toBeDefined();
  });

  it("renders the session's model", async () => {
    server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = await loadedPicker(/^model/i);
    // The provider group heading names the provider, so the option label —
    // and the closed input — carry the bare model name.
    expect(combobox.value).toBe("claude");
  });

  it("labels nothing while the model listing loads, then resolves the shortcut name", async () => {
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
          shortcuts: { text: { flash: "a:small", pro: "a:mid" } },
        });
      }),
    );
    renderControls(<SessionModelControls id="s1" />);

    // While the listing is in flight the closed input must not show the bare
    // committed value — the label that would immediately be replaced.
    await openSettings();
    const combobox = (await screen.findByRole("combobox", { name: /^model/i })) as HTMLInputElement;
    expect(combobox.value).toBe("");
    expect(combobox.disabled).toBe(true);

    release();
    // Once settled, the shortcut group labels the value — no intermediate label.
    await waitFor(() => expect(combobox.value).toBe("flash"));
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = await loadedPicker(/^model/i);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await loadedPicker(/^model/i));
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["claude", "gemini", "gpt"]);
    // Each provider heads its own group under its configured name.
    for (const provider of ["anthropic", "google", "openai"]) {
      expect(screen.getByText(provider)).toBeDefined();
    }
  });

  it("pins the configured text shortcuts, in config order, ahead of the full model listing", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [
            { id: "anthropic:claude", provider: "anthropic", output: "text" },
            { id: "openai:gpt", provider: "openai", output: "text" },
          ],
          failures: [],
          shortcuts: {
            text: { gpt: "openai:gpt", sonnet: "anthropic:claude" },
          },
        }),
      ),
    );
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await loadedPicker(/^model/i));
    // Shortcut entries carry the shortcut name alone, in config order; the
    // listing follows grouped by provider with bare model-name labels.
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["gpt", "sonnet", "claude", "gpt"]);
    // The pinned shortcuts group is headed "kiri"; the providers head their own.
    for (const heading of ["kiri", "anthropic", "openai"]) {
      expect(screen.getByText(heading)).toBeDefined();
    }
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await loadedPicker(/^model/i));
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["claude"]);
  });

  it("pins the configured image shortcuts ahead of the image model listing", async () => {
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
          shortcuts: {
            image: { images: "openai:gpt-image" },
          },
        }),
      ),
    );
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await loadedPicker(/image model/i));
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["images", "None", "gpt-image"]);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await loadedPicker(/image model/i));
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["None", "gpt-image-1", "google/gemini-image"]);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await loadedPicker(/^model/i);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = await loadedPicker(/image model/i);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = await loadedPicker(/image model/i);
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
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = await loadedPicker(/image model/i);
    expect(combobox.value).toBe("delisted-image");
  });

  it("labels nothing while the image listing loads, then resolves the shortcut name", async () => {
    // Gate the listing so the in-flight window is observable.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/sessions/:id", () =>
        HttpResponse.json(sessionDetail({ imageModel: "a:paint" })),
      ),
      http.get("*/api/models", async () => {
        await gate;
        return HttpResponse.json({
          models: [{ id: "a:paint", provider: "a", output: "image" }],
          failures: [],
          shortcuts: { image: { images: "a:paint" } },
        });
      }),
    );
    renderControls(<SessionModelControls id="s1" />);

    // While the listing is in flight the closed input must not show the bare
    // committed value — the label that would immediately be replaced.
    await openSettings();
    const combobox = (await screen.findByRole("combobox", {
      name: /image model/i,
    })) as HTMLInputElement;
    expect(combobox.value).toBe("");
    expect(combobox.disabled).toBe(true);

    release();
    // Once settled, the shortcut group labels the value — no intermediate label.
    await waitFor(() => expect(combobox.value).toBe("images"));
    expect(combobox.disabled).toBe(false);
  });

  it("surfaces the image picker only once the listing lands an image model", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", async () => {
        await gate;
        return HttpResponse.json({
          models: [{ id: "a:paint", provider: "a", output: "image" }],
          failures: [],
        });
      }),
    );
    renderControls(<SessionModelControls id="s1" />);

    // No image model selected and none listed yet — nothing to pick from.
    await openSettings();
    await screen.findByRole("combobox", { name: /^model/i });
    expect(screen.queryByRole("combobox", { name: /image model/i })).toBeNull();

    release();
    // The listing lands an image model, so the picker appears, off by default.
    const combobox = (await screen.findByRole("combobox", {
      name: /image model/i,
    })) as HTMLInputElement;
    await waitFor(() => expect(combobox.value).toBe("None"));
  });

  it("always offers the effort control at the session's stored level", async () => {
    // No model listing needed: effort calibrates the assistant on every
    // model, so the control never depends on what the listing reports.
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () => HttpResponse.json({ models: [], failures: [] })),
    );
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    expect(await screen.findByRole("radiogroup", { name: /effort/i })).toBeDefined();
    // The session's stored level is the selected segment.
    // The medium segment's visible label is "med"; the committed value stays "medium".
    expect((screen.getByRole("radio", { name: "med" }) as HTMLInputElement).checked).toBe(true);
  });

  it("changes the session's effort when a level is picked", async () => {
    let patched: { effort?: string } = {};
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())),
      http.get("*/api/models", () =>
        HttpResponse.json({
          models: [{ id: "anthropic:claude", provider: "anthropic", output: "text" }],
          failures: [],
        }),
      ),
      http.patch("*/api/sessions/:id", async ({ request }) => {
        patched = (await request.json()) as { effort?: string };
        return HttpResponse.json(sessionDetail({ effort: "high" }));
      }),
    );
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    await userEvent.click(await screen.findByRole("radio", { name: "high" }));

    await waitFor(() => expect(patched.effort).toBe("high"));
    // The control reflects the choice from the PATCH response, without a
    // refetch — the mocked GET still returns medium.
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: "high" }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("disables the controls while a turn is in flight", async () => {
    server.use(
      http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail({ status: "running" }))),
    );
    renderControls(<SessionModelControls id="s1" />);

    await openSettings();
    const combobox = (await screen.findByRole("combobox", { name: /^model/i })) as HTMLInputElement;
    expect(combobox.disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "med" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("renders nothing until the session loads", () => {
    server.use(http.get("*/api/sessions/:id", () => new Promise<Response>(() => {})));
    const { container } = renderControls(<SessionModelControls id="s1" />);
    expect(container.firstChild).toBeNull();
  });

  describe("microphone", () => {
    const microphone = (overrides: Partial<MicrophoneState> = {}) => {
      const calls = { setDevice: [] as (string | undefined)[], refreshes: 0 };
      const state: MicrophoneState = {
        available: true,
        status: "idle",
        inputs: [
          { id: "built-in", label: "MacBook Pro Microphone" },
          { id: "usb-1", label: "USB Audio" },
          { id: "unnamed", label: "" },
        ],
        deviceId: "usb-1",
        setDevice: (deviceId) => calls.setDevice.push(deviceId),
        refreshInputs: () => {
          calls.refreshes += 1;
        },
        ...overrides,
      };
      return { state, calls };
    };

    it("offers no microphone picker without push-to-talk", async () => {
      server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
      renderControls(
        <SessionModelControls id="s1" microphone={microphone({ available: false }).state} />,
      );

      await openSettings();
      expect(screen.queryByRole("combobox", { name: /microphone/i })).toBeNull();
    });

    it("lists the inputs behind the browser default, selected on the chosen one, re-listing on open", async () => {
      server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
      const { state, calls } = microphone();
      renderControls(<SessionModelControls id="s1" microphone={state} />);

      await openSettings();
      const picker = screen.getByRole("combobox", { name: /microphone/i }) as HTMLSelectElement;

      expect(picker.value).toBe("usb-1");
      expect(Array.from(picker.options).map((option) => option.textContent)).toEqual([
        "Browser default",
        "MacBook Pro Microphone",
        "USB Audio",
        // An input the browser names nothing shows its id.
        "unnamed",
      ]);
      expect(calls.refreshes).toBe(1);
    });

    it("chooses an input, and the browser default", async () => {
      server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
      const { state, calls } = microphone();
      renderControls(<SessionModelControls id="s1" microphone={state} />);
      await openSettings();
      const picker = screen.getByRole("combobox", { name: /microphone/i });

      await userEvent.selectOptions(picker, "built-in");
      await userEvent.selectOptions(picker, "");

      expect(calls.setDevice).toEqual(["built-in", undefined]);
    });

    it("locks the picker while a hold or its transcription is in progress", async () => {
      server.use(http.get("*/api/sessions/:id", () => HttpResponse.json(sessionDetail())));
      renderControls(
        <SessionModelControls id="s1" microphone={microphone({ status: "recording" }).state} />,
      );

      await openSettings();

      expect(
        (screen.getByRole("combobox", { name: /microphone/i }) as HTMLSelectElement).disabled,
      ).toBe(true);
    });
  });
});
